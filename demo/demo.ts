// The demo harness. It gates each case on fonts and the viewport, splits it, reveals it with the Web
// Animations API (or leaves the reveal to the stylesheet), and can check every split against the
// lines the browser painted before the split ran. Nothing here is part of the library.

import { type SplitLevel, splitText, type TextSplit } from "../src/index";

type Reveal = {
  target: HTMLElement;
  section: HTMLElement;
  unit: SplitLevel;
  mask: SplitLevel[];
  ignore: string | undefined;
  css: boolean;
  split: TextSplit | null;
  expected: Painted;
};

/** What the browser painted: the lines' text, where each ends, and the target's height. */
type Painted = {
  lines: string[];
  ends: { x: number; y: number }[];
  height: number;
};

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
const DURATION = 1000;
const STAGGER: Record<SplitLevel, number> = { lines: 100, words: 30, chars: 15 };

/** A frame this far past 60fps is one the reveal visibly dropped. */
const SLOW_FRAME_MS = 34;

/** Rects closer than this on the block axis sit on the same line; a raised superscript is well within it. */
const SAME_LINE_TOLERANCE = 2;

/** How far a line may end from where it was painted. WebKit reports range rects rounded, so a pixel is its own noise. */
const MOVE_TOLERANCE = 1.5;

const words = new Intl.Segmenter(undefined, { granularity: "word" });
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

const isLevel = (value: string | null | undefined): value is SplitLevel =>
  value === "lines" || value === "words" || value === "chars";

/** Containers whose inline content lays out as lines of its own, the same set the splitter recurses into. */
const BLOCK_CONTAINERS = new Set(["block", "list-item", "flow-root", "table-cell", "table-caption"]);

const isInlineLevel = (display: string) => display.startsWith("inline") || display === "contents" || display === "ruby";

/**
 * A block-level child of a block container that is not running text: a table, a button row, a
 * box-like custom element, a list item with an inside marker, or a block the case asks to ignore.
 * The splitter leaves such an element out of the split, so its text is no painted line either.
 * Anything inside an inline piece (a ruby's annotation) is part of that piece, whatever its display.
 */
function isWholeBlock(element: HTMLElement, target: HTMLElement, ignore: string | undefined): boolean {
  const parent = element.parentElement;

  if (!parent || (parent !== target && !BLOCK_CONTAINERS.has(getComputedStyle(parent).display))) {
    return false;
  }

  const style = getComputedStyle(element);

  if (isInlineLevel(style.display) || style.getPropertyValue("float") !== "none") {
    return false;
  }

  return (
    (ignore !== undefined && element.matches(ignore)) ||
    element.tagName.includes("-") ||
    (style.display === "list-item" && style.listStylePosition === "inside") ||
    !BLOCK_CONTAINERS.has(style.display)
  );
}

/**
 * The lines the browser painted, read off an unsplit target the way the splitter reads them, but
 * independently: consecutive words' rects, a new line where a rect moves to a later line, back to an
 * earlier one, or back to the line start. Hidden content is laid out but not painted, so it is
 * skipped, and so is a block-level piece that is not text, since the split never touches it.
 */
function paintedLines(target: HTMLElement, relativeTo: HTMLElement = target, ignore?: string): Painted {
  const style = getComputedStyle(relativeTo);
  const vertical = style.writingMode.startsWith("vertical");
  const rtl = style.direction === "rtl";
  const leftward = style.writingMode.endsWith("-rl");
  const across = (rect: DOMRect) => (vertical ? (leftward ? -rect.right : rect.left) : rect.top);
  const acrossEnd = (rect: DOMRect) => (vertical ? (leftward ? -rect.left : rect.right) : rect.bottom);
  const along = (rect: DOMRect) => (vertical ? rect.top : rtl ? -rect.right : rect.left);
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, (node) =>
    node instanceof HTMLElement && (!node.checkVisibility() || isWholeBlock(node, target, ignore))
      ? NodeFilter.FILTER_REJECT
      : NodeFilter.FILTER_ACCEPT
  );
  const lines: string[] = [];
  const ends: { x: number; y: number }[] = [];
  const origin = relativeTo.getBoundingClientRect();
  const alongEnd = (rect: DOMRect) => (vertical ? rect.bottom : rtl ? -rect.left : rect.right);

  // Rects that overlap across the line share a row; rows come back in reading order.
  const rowsOf = (rects: DOMRectList) => {
    const rows: DOMRect[] = [];

    for (const rect of Array.from(rects)) {
      if (rect.width === 0 && rect.height === 0) {
        continue;
      }

      const shared = rows.some(
        (row) => across(rect) < acrossEnd(row) - SAME_LINE_TOLERANCE && acrossEnd(rect) > across(row) + SAME_LINE_TOLERANCE
      );

      if (!shared) {
        rows.push(rect);
      }
    }

    return rows;
  };
  let current = "";
  let previous: DOMRect | null = null;

  // A line is anchored on its far edge and on the row of its last piece: its first piece can be a
  // first-letter pseudo or a grapheme after a break, which browsers report with boxes of their own
  // choosing, and a char split makes every glyph a piece. Far edges are read off whole-word rects
  // and kept per row, so a hyphen the browser drew on the line a word left counts the same as the
  // hyphen the split restates there.
  const rows: { row: number; far: number }[] = [];

  const rowOf = (rect: DOMRect) => rows.find((entry) => Math.abs(entry.row - across(rect)) <= SAME_LINE_TOLERANCE);

  const reach = (rect: DOMRect) => {
    const entry = rowOf(rect);

    if (entry) {
      entry.far = Math.max(entry.far, alongEnd(rect));
    } else {
      rows.push({ row: across(rect), far: alongEnd(rect) });
    }
  };

  const endLine = () => {
    if (previous) {
      const far = rowOf(previous)?.far ?? alongEnd(previous);

      ends.push({
        x: far - (vertical ? origin.top : rtl ? -origin.right : origin.left),
        y: across(previous) - (vertical ? origin.left : origin.top),
      });
    }

    lines.push(current);
    current = "";
  };

  const place = (node: Text, start: number, end: number, text: string) => {
    const range = document.createRange();

    range.setStart(node, start);
    range.setEnd(node, end);

    const rects = range.getClientRects();

    if (rects.length === 0) {
      current += text;
      return;
    }

    // A word the browser broke inside. The break before each row is found with prefix ranges, the
    // same way the splitter finds it and independently of grapheme rects, which Chrome and Firefox
    // both misreport around a hyphenation break.
    if (rects.length > 1 && end - start > 1) {
      const rows = rowsOf(rects);

      if (rows.length > 1) {
        const list = Array.from(graphemes.segment(text)).map((grapheme) => ({
          index: grapheme.index,
          length: grapheme.segment.length,
        }));
        const rowsOfPrefix = (count: number) => {
          const last = list[count - 1];
          const prefix = document.createRange();

          prefix.setStart(node, start);
          prefix.setEnd(node, start + last.index + last.length);

          return rowsOf(prefix.getClientRects()).length;
        };
        let from = 0;

        if (previous) {
          const rect = rows[0];
          const later = across(rect) >= acrossEnd(previous) - SAME_LINE_TOLERANCE;
          const earlier = acrossEnd(rect) <= across(previous) + SAME_LINE_TOLERANCE;
          const back = across(rect) > across(previous) + SAME_LINE_TOLERANCE && along(rect) < along(previous) - 1;

          if (later || earlier || back) {
            endLine();
          }
        }

        for (let row = 1; row < rows.length; row += 1) {
          let low = from + 1;
          let high = list.length;

          while (low < high) {
            const mid = (low + high) >> 1;

            if (rowsOfPrefix(mid) > row) {
              high = mid;
            } else {
              low = mid + 1;
            }
          }

          const breaks = low - 1;

          if (breaks <= from || breaks >= list.length) {
            break;
          }

          current += text.slice(list[from].index, list[breaks].index);
          previous = rows[row - 1];
          endLine();
          from = breaks;
        }

        current += text.slice(list[from].index);
        previous = rows[rows.length - 1];
        return;
      }
    }

    const rect = rects[0];

    if (previous) {
      const later = across(rect) >= acrossEnd(previous) - SAME_LINE_TOLERANCE;
      const earlier = acrossEnd(rect) <= across(previous) + SAME_LINE_TOLERANCE;
      const back = across(rect) > across(previous) + SAME_LINE_TOLERANCE && along(rect) < along(previous) - 1;

      if (later || earlier || back) {
        endLine();
      }
    }

    current += text;
    previous = rect;
    reach(rect);
  };

  let node = walker.nextNode();

  while (node) {
    if (node instanceof Text) {
      for (const word of words.segment(node.data)) {
        if (word.segment.trim()) {
          // The whole word's rects first: a drawn hyphen is one of them, on the line the word left,
          // and a line ending in that word reads its far edge as soon as it ends.
          const range = document.createRange();

          range.setStart(node, word.index);
          range.setEnd(node, word.index + word.segment.length);

          for (const rect of range.getClientRects()) {
            reach(rect);
          }

          place(node, word.index, word.index + word.segment.length, word.segment);
        } else {
          current += word.segment;
        }
      }
    }

    node = walker.nextNode();
  }

  if (current.trim()) {
    endLine();
  }

  return { lines: lines.map(collapse), ends, height: origin.height };
}

/**
 * The geometry after the split, read off the line blocks themselves: every line's text still ends
 * where it did and its last piece sits on the same row, and the target is as tall.
 */
function keepsGeometry(before: Painted, target: HTMLElement, lines: HTMLElement[]): string | null {
  const height = target.getBoundingClientRect().height;

  if (Math.abs(before.height - height) > 1) {
    return `height ${before.height.toFixed(1)} became ${height.toFixed(1)}`;
  }

  const after = lines.map((line) => paintedLines(line, target)).filter((painted) => painted.ends.length > 0);

  if (before.ends.length === after.length) {
    for (const [index, end] of before.ends.entries()) {
      const moved = after[index].ends[after[index].ends.length - 1];

      if (Math.abs(end.x - moved.x) > MOVE_TOLERANCE || Math.abs(end.y - moved.y) > MOVE_TOLERANCE) {
        return `line ${index + 1} moved by ${(moved.x - end.x).toFixed(1)}, ${(moved.y - end.y).toFixed(1)}`;
      }
    }
  }

  return null;
}

/**
 * True when the split lines cover the painted ones in order. A hyphenated line end gains the hyphen
 * the browser only drew, and an inline piece kept whole may join two painted words, so the
 * comparison ignores spacing and a trailing hyphen.
 */
function coversPainted(expected: string[], actual: string[]): boolean {
  const key = (text: string) => text.replace(/\s+/g, "").replace(/-$/, "");
  let index = 0;

  for (const line of actual) {
    const wanted = key(line);
    let joined = "";

    while (index < expected.length && joined.length < wanted.length) {
      joined += key(expected[index]);
      index += 1;
    }

    if (joined !== wanted) {
      return false;
    }
  }

  return index === expected.length;
}

/**
 * A split line's text, with the text of the floats the split put back in front of it (a drop cap's
 * glyph), which the painted lines read in place on that line.
 */
function lineText(line: HTMLElement): string {
  let outer: Element = line;
  let leading = "";

  while (outer.parentElement?.hasAttribute("data-mask")) {
    outer = outer.parentElement;
  }

  for (let node = outer.previousSibling; node; node = node.previousSibling) {
    if (node instanceof HTMLElement && getComputedStyle(node).float !== "none") {
      leading = (node.textContent ?? "") + leading;
    } else if (!(node instanceof Text && !node.data.trim())) {
      break;
    }
  }

  return leading + (line.textContent ?? "");
}

class Demo {
  reveals: Reveal[] = [];
  observer: IntersectionObserver;
  readout: HTMLElement;
  splitTimes: number[] = [];
  longTasks = 0;
  frames = 0;
  slowFrames = 0;
  lastFrame = performance.now();

  constructor() {
    this.readout = document.querySelector<HTMLElement>("[data-readout]") as HTMLElement;
    this.observer = new IntersectionObserver(this.onIntersect, { rootMargin: "0px 0px -10% 0px" });

    for (const section of document.querySelectorAll<HTMLElement>("section[data-case]")) {
      const target = section.querySelector<HTMLElement>("[data-target]");

      if (!target) {
        continue;
      }

      const mask = section.dataset.mask;

      this.reveals.push({
        target,
        section,
        unit: isLevel(section.dataset.unit) ? section.dataset.unit : "lines",
        mask:
          mask === "none"
            ? []
            : mask
              ? mask.split(" ").filter(isLevel)
              : [isLevel(section.dataset.unit) ? section.dataset.unit : "lines"],
        ignore: section.dataset.ignore,
        css: section.dataset.reveal === "css",
        split: null,
        expected: { lines: [], ends: [], height: 0 },
      });
    }

    new PerformanceObserver((list) => {
      this.longTasks += list.getEntries().length;
      this.render();
    }).observe({ entryTypes: ["longtask"] });

    const nav = document.querySelector("[data-nav]");

    for (const reveal of this.reveals) {
      const link = document.createElement("a");

      link.href = `#${reveal.section.dataset.case}`;
      link.textContent = reveal.section.dataset.case ?? "";
      reveal.section.id = reveal.section.dataset.case ?? "";
      nav?.append(link);
    }

    document.querySelector("[data-action=check]")?.addEventListener("click", this.check);
    document.querySelector("[data-action=replay]")?.addEventListener("click", this.replay);

    requestAnimationFrame(this.onFrame);

    void document.fonts.ready.then(this.start);
  }

  /** Painted lines are read before any split, in the real face; every target then waits for the viewport. */
  start = () => {
    for (const reveal of this.reveals) {
      reveal.expected = paintedLines(reveal.target, reveal.target, reveal.ignore);
      this.observer.observe(reveal.target);
    }

    this.render();
  };

  onIntersect = (entries: IntersectionObserverEntry[]) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue;
      }

      this.observer.unobserve(entry.target);

      const reveal = this.reveals.find((candidate) => candidate.target === entry.target);

      if (reveal) {
        this.play(reveal);
      }
    }
  };

  play(reveal: Reveal) {
    const start = performance.now();

    reveal.split = splitText(reveal.target, { type: [reveal.unit], mask: reveal.mask, ignore: reveal.ignore });
    this.splitTimes.push(performance.now() - start);
    this.render();

    if (reveal.css) {
      reveal.target.setAttribute("data-revealed", "");
      return;
    }

    const units = reveal.split[reveal.unit];
    const masks = reveal.split.masks;

    for (const mask of masks) {
      mask.style.clipPath = "inset(0)";
    }

    const animations = units.map((unit, index) =>
      unit.animate(
        [
          { transform: "translateY(100%)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        {
          duration: DURATION,
          delay: index * STAGGER[reveal.unit],
          easing: EASE,
          fill: "both",
        }
      )
    );

    reveal.target.setAttribute("data-revealed", "");

    // The masks only exist to hide a unit on its way up; at rest they would clip descenders and focus rings.
    void Promise.all(animations.map((animation) => animation.finished)).then(() => {
      for (const mask of masks) {
        mask.style.clipPath = "none";
      }

      // The reveal ends in the unit's own resting state, so the animations are simply dropped.
      for (const animation of animations) {
        animation.cancel();
      }
    });
  }

  onFrame = (now: number) => {
    this.frames += 1;

    if (now - this.lastFrame > SLOW_FRAME_MS) {
      this.slowFrames += 1;
      this.render();
    }

    this.lastFrame = now;
    requestAnimationFrame(this.onFrame);
  };

  /** Every target on screen has split by now; one that has not is reported as such rather than judged. */
  check = () => {
    let mismatches = 0;

    for (const reveal of this.reveals) {
      const result = reveal.section.querySelector<HTMLElement>(".case-result");
      const actual = reveal.split ? reveal.split.lines.map((line) => collapse(lineText(line))).filter(Boolean) : [];
      const geometry = reveal.split ? keepsGeometry(reveal.expected, reveal.target, reveal.split.lines) : null;
      let status = "ok";
      let verdict: string;

      if (!reveal.split) {
        status = "pending";
        verdict = "not split yet";
      } else if (!coversPainted(reveal.expected.lines, actual)) {
        mismatches += 1;
        status = "mismatch";
        verdict = `painted ${reveal.expected.lines.length} lines, split ${actual.length}\n${reveal.expected.lines.join(" | ")}\nvs\n${actual.join(" | ")}`;
      } else if (geometry) {
        mismatches += 1;
        status = "mismatch";
        verdict = `${actual.length} lines as painted, but ${geometry}`;
      } else {
        verdict = `${actual.length} lines, as painted, nothing moved`;
      }

      reveal.section.dataset.status = status;

      if (result) {
        result.textContent = verdict;
      }
    }

    this.render(`checked: ${mismatches} mismatching`);
  };

  /** Everything reverts, the painted lines are read again (a resize may have moved them), and every target waits for the viewport again. */
  replay = () => {
    this.splitTimes = [];
    this.longTasks = 0;
    this.frames = 0;
    this.slowFrames = 0;

    for (const reveal of this.reveals) {
      reveal.split?.revert();
      reveal.split = null;
      reveal.target.removeAttribute("data-revealed");
      reveal.section.removeAttribute("data-status");

      const result = reveal.section.querySelector<HTMLElement>(".case-result");

      if (result) {
        result.textContent = "";
      }
    }

    this.start();
  };

  render(note = "") {
    const total = this.splitTimes.reduce((sum, time) => sum + time, 0);
    const worst = this.splitTimes.reduce((max, time) => Math.max(max, time), 0);

    this.readout.textContent = [
      `targets ${this.reveals.length}`,
      `splits ${this.splitTimes.length}`,
      `split total ${total.toFixed(1)}ms, worst ${worst.toFixed(1)}ms`,
      `long tasks ${this.longTasks}`,
      `slow frames ${this.slowFrames} / ${this.frames}`,
      note,
    ]
      .filter(Boolean)
      .join("\n");
  }
}

const demo = new Demo();

// The harness on the window, so a devtools session can run the probe by hand.
Object.assign(window, { kugiriDemo: { demo, paintedLines, splitText } });
