// kugiri: a text splitter that keeps the lines the browser painted. Lines are read off the text itself
// (`Range.getClientRects()` per word) and cut with `Range.extractContents()`, so nothing about the
// layout changes before it is measured; words and graphemes are wrapped inside those lines, under
// `text-wrap: nowrap`, so their inline-block boxes can never move a wrap either. Anything that is
// not running text (an image, a button row, a table, a custom element, an ignored element, hidden
// content) is never cut into: it rides along as one piece.
//
// Two phases, never interleaved: every layout and style read happens first, against a layout that
// is still clean, and every DOM write after, so a split of a whole article forces no reflow at all.
//
// The split only structures and marks: every unit carries `data-line`, `data-word` or `data-char`
// with its index, the same index as a custom property (`--line`, `--word`, `--char`) for a CSS
// stagger, and a mask carries `data-mask`; the target carries `data-split` and the counts
// (`--lines`, `--words`, `--chars`). The consumer owns the animation, in CSS or in script.
//
// Dependency-free on purpose: it ships to other projects as-is.

export type SplitLevel = "lines" | "words" | "chars";

export type SplitOptions = {
  /** The units to produce. Words and chars always sit inside lines, so `lines` comes with them. */
  type?: SplitLevel[];
  /** The units that get a clipping wrapper (`clip-path: inset(0)`) to slide out from under: any of the levels, or none. */
  mask?: SplitLevel | SplitLevel[];
  /** A selector for elements to leave whole: never cut into, never wrapped, never a unit. */
  ignore?: string;
  /** Class names to add to the units and masks, on top of the data attributes they always carry. */
  classes?: Partial<Record<SplitLevel | "mask", string>>;
};

export type TextSplit = {
  lines: HTMLElement[];
  words: HTMLElement[];
  chars: HTMLElement[];
  masks: HTMLElement[];
  /** Puts the original markup back. */
  revert: () => void;
};

type Row = { rect: DOMRect; start: number; end: number };

type Segment = {
  index: number;
  length: number;
  /** The painted box of a word that sits on one line. */
  rect?: DOMRect;
  /** The row the word starts on and the row it ends on (the same for a word on one line), with how far each reaches. */
  first?: Row;
  last?: Row;
  /** The painted extent along the line, restated on the unit so boxing the word moves nothing. */
  size?: number;
  /** The same per grapheme, read when chars are asked for. */
  graphemeSizes?: number[];
  /** The painted room between this word and the next on the same line, restated on the space between their boxes. */
  gap?: number;
};

/**
 * Where a line starts: a character in a text node, or in front of a node. A break inside a word
 * also records the fragment the word leaves on the line before it, and how far that fragment
 * reached there, hyphen included; the cut then learns from the fragment's natural width whether
 * the browser had drawn a hyphen, and how wide.
 */
type Boundary =
  | { text: Text; offset: number; fragment: { start: number; extent: number; next: number } | null }
  | { before: Node };

type Kind = "inline" | "block" | "atom" | "float" | "hidden";

/** A text node in a run, with its words and whether a link's underline has to be carried onto them. */
type TextPlan = {
  node: Text;
  words: Segment[];
  decorated: boolean;
  /** The painted room before the first word, when the previous word of the run sits on the same line. */
  leadGap?: number;
  /** The same after the last word, when the next text of the run carries no whitespace of its own. */
  trailGap?: number;
};

type Piece = { text: TextPlan } | { atom: HTMLElement };

type Sink = Pick<TextSplit, "lines" | "words" | "chars" | "masks">;

/** The declarations a container's `::first-letter` adds to its first glyph. */
type FirstLetter = {
  declarations: string;
};

type RunPlan = {
  container: Element;
  from: number;
  firstLetter: FirstLetter | null;
  /** What the container's `::first-line` changes, restated on the first line block. */
  firstLine: string;
  /** How far the first painted row reaches, to check the restated first line against. */
  firstRowEnd: number;
  /** The node the run ends in front of, held by reference because wrapping shifts child indexes. */
  anchor: Node | null;
  starts: Boundary[];
  pieces: Piece[];
  along: (rect: DOMRect) => Span;
  justify: boolean;
  /** The container indents its first line, which every line block after the first would repeat. */
  indent: boolean;
  sink: Sink;
};

type Item = { run: RunPlan } | { block: HTMLElement; items: Item[] } | { atom: HTMLElement };

type Context = {
  target: HTMLElement;
  wrapWords: boolean;
  wrapChars: boolean;
  mask: Set<SplitLevel>;
  ignore: string | undefined;
  kinds: Map<Element, Kind>;
  displays: Map<Element, string>;
  /** Per element: the nearest ancestor-or-self that declares a decoration, or null. */
  decorations: Map<Element, HTMLElement | null>;
  /** Elements between a decorated ancestor and its text, made to pass the decoration down. */
  inheritors: Set<HTMLElement>;
  /** A decoration declared above the target, copied onto it. */
  targetDecoration: string[] | null;
  /** Wrappers made here, with the style each one is written with, once, at the end. */
  created: Map<HTMLElement, string>;
  /** Every element the target held before the split; anything else empty in a line is a clone the cut left. */
  originals: Set<Element>;
  /** First lines whose container styles its first letter, checked once every style is written. */
  firstLetters: { line: HTMLElement; firstLetter: FirstLetter }[];
  /** First lines restating a `::first-line`, verified against the painted row once every style is written. */
  firstLines: { line: HTMLElement; declarations: string; end: number; along: (rect: DOMRect) => Span }[];
};

/** Rects closer than this on the block axis sit on the same line; a raised superscript is well within it. */
const SAME_LINE_TOLERANCE = 2;

/** Containers whose inline content lays out as lines of their own; everything else with text is one piece. */
const BLOCK_DISPLAYS = new Set(["block", "list-item", "flow-root", "table-cell", "table-caption"]);

const INLINE_DISPLAYS = new Set(["inline", "contents"]);

/** A decoration is drawn by the element that declares it and never reaches into an inline-block. */
const DECORATION_PROPS = [
  "text-decoration-line",
  "text-decoration-style",
  "text-decoration-color",
  "text-decoration-thickness",
  "text-underline-offset",
  "text-decoration-skip-ink",
];

const INHERIT_DECORATION = DECORATION_PROPS.map((prop) => `${prop}:inherit`).join(";");

const UNIT_ATTRIBUTE: Record<SplitLevel, string> = { lines: "line", words: "word", chars: "char" };

/**
 * What a `::first-letter` rule can change about the glyph, with what each property is when no rule
 * touches it: inherited ones take the container's value, the rest their initial value. Only a
 * property that differs from that is a declaration worth restating.
 */
const FIRST_LETTER_INHERITED = [
  "font-size",
  "font-weight",
  "font-style",
  "font-family",
  "font-variant",
  "line-height",
  "letter-spacing",
  "color",
  "text-transform",
  "text-shadow",
];

/** What a `::first-line` rule can change; all inherited, so a line block restating them passes them on. */
const FIRST_LINE_PROPS = [
  "font-size",
  "font-weight",
  "font-style",
  "font-family",
  "font-variant",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "color",
  "text-transform",
  "text-shadow",
  "text-decoration-line",
  "text-decoration-color",
  "text-decoration-style",
  "background-color",
];

const FIRST_LETTER_INITIAL: Record<string, string> = {
  float: "none",
  "margin-top": "0px",
  "margin-right": "0px",
  "margin-bottom": "0px",
  "margin-left": "0px",
  "padding-top": "0px",
  "padding-right": "0px",
  "padding-bottom": "0px",
  "padding-left": "0px",
  "vertical-align": "baseline",
  "background-color": "rgba(0, 0, 0, 0)",
};

const wordSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;

const graphemeSegmenter = wordSegmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

const splits = new WeakMap<Element, TextSplit>();

/**
 * The words of a text run. Punctuation stays attached to its neighbour, so "Hello," is one word as
 * it would be to a reader, while two word-like segments with nothing between them (Japanese,
 * Thai) are two words, which is the only way a script without spaces gets a word split at all.
 */
function* words(text: string): Generator<Segment> {
  if (!wordSegmenter) {
    for (const match of text.matchAll(/\S+/g)) {
      yield { index: match.index, length: match[0].length };
    }

    return;
  }

  let current: Segment | null = null;
  let lastWordLike = false;

  for (const segment of wordSegmenter.segment(text)) {
    const blank = !segment.segment.trim();
    const wordLike = segment.isWordLike === true;

    if (blank || (current && wordLike && lastWordLike)) {
      if (current) {
        yield current;
      }

      current = null;
    }

    if (!blank) {
      current = current
        ? { index: current.index, length: current.length + segment.segment.length }
        : { index: segment.index, length: segment.segment.length };
    }

    lastWordLike = !blank && wordLike;
  }

  if (current) {
    yield current;
  }
}

function* graphemes(text: string): Generator<Segment> {
  if (graphemeSegmenter) {
    for (const segment of graphemeSegmenter.segment(text)) {
      yield { index: segment.index, length: segment.segment.length };
    }

    return;
  }

  let index = 0;

  for (const char of Array.from(text)) {
    yield { index, length: char.length };
    index += char.length;
  }
}

const childIndex = (node: Node) => Array.prototype.indexOf.call(node.parentNode?.childNodes ?? [], node);

const isBlank = (node: Node) => node instanceof Text && !node.data.trim();

const isInlineLevel = (display: string) => display.startsWith("inline") || display === "contents" || display === "ruby";

function displayOf(element: Element, context: Context): string {
  let value = context.displays.get(element);

  if (value === undefined) {
    value = getComputedStyle(element).display;
    context.displays.set(element, value);
  }

  return value;
}

/**
 * How an element takes part. Inline elements are cut into and recursed, a custom element with
 * inline display included, since its text wraps like any other and can only keep wrapping if the
 * cut reaches it; block containers lay out their own lines and are split as targets of their own;
 * everything else is one piece, which covers replaced elements, inline-blocks, ruby, flex and grid
 * rows, tables, list items with an inside marker (a summary's caret is inline content on its first
 * line), custom elements that are boxes of their own, and whatever the caller asked to ignore. A
 * float is out of the flow: it stays where it is in the run and is neither measured nor a unit.
 * Hidden content is left exactly as it is.
 */
function classify(element: Element, context: Context): Kind {
  const known = context.kinds.get(element);

  if (known !== undefined) {
    return known;
  }

  const kind = classifyUncached(element, context);

  context.kinds.set(element, kind);

  return kind;
}

function classifyUncached(element: Element, context: Context): Kind {
  if (element instanceof HTMLElement && !element.checkVisibility()) {
    return "hidden";
  }

  const style = getComputedStyle(element);

  context.displays.set(element, style.display);

  if (style.getPropertyValue("float") !== "none") {
    return "float";
  }

  if (context.ignore && element.matches(context.ignore)) {
    return "atom";
  }

  if (!element.textContent?.trim()) {
    return "atom";
  }

  if (INLINE_DISPLAYS.has(style.display)) {
    return "inline";
  }

  if (element.tagName.includes("-")) {
    return "atom";
  }

  if (style.display === "list-item" && style.listStylePosition === "inside") {
    return "atom";
  }

  if (BLOCK_DISPLAYS.has(style.display)) {
    return "block";
  }

  return "atom";
}

/**
 * Whether the text under `parent` is decorated by an ancestor (a link's underline). The chain in
 * between is noted so it can be made to inherit the decoration, which lets a unit wrapped as an
 * inline-block draw the same underline and follow a hover on the link; a decoration declared above
 * the target is copied onto the target instead, since nothing outside it may be touched.
 */
function carriesDecoration(parent: Element, context: Context): boolean {
  const decorated = decorationOf(parent, context);

  if (!decorated) {
    return false;
  }

  for (let link: Element | null = parent; link instanceof HTMLElement && link !== decorated; link = link.parentElement) {
    if (link === context.target || !context.target.contains(link)) {
      break;
    }

    context.inheritors.add(link);
  }

  if (!context.target.contains(decorated) && !context.targetDecoration) {
    const style = getComputedStyle(decorated);

    context.targetDecoration = DECORATION_PROPS.map((prop) => `${prop}:${style.getPropertyValue(prop)}`);
  }

  return true;
}

/** Memoised per element, so a whole article reads each ancestor's decoration once. */
function decorationOf(element: Element, context: Context): HTMLElement | null {
  const known = context.decorations.get(element);

  if (known !== undefined) {
    return known;
  }

  let found: HTMLElement | null = null;

  if (element instanceof HTMLElement) {
    if (getComputedStyle(element).textDecorationLine !== "none") {
      found = element;
    } else if (element.parentElement) {
      found = decorationOf(element.parentElement, context);
    }
  }

  context.decorations.set(element, found);

  return found;
}

/**
 * The read phase for one run of inline nodes: where each line after the first begins, and every
 * text node's words. A new line starts wherever a piece's rect drops below the previous one or
 * jumps back to the line start; a word the browser broke inside (overflow-wrap, hyphenation)
 * yields several rects and is re-read grapheme by grapheme.
 */
function planRun(container: Element, from: number, to: number, context: Context): RunPlan | null {
  const nodes = Array.from(container.childNodes).slice(from, to);

  if (nodes.every(isBlank)) {
    return null;
  }

  const style = getComputedStyle(container);
  const justify = style.textAlign === "justify";
  const indent = style.textIndent !== "0px";
  const { along, across } = axes(style);
  const range = document.createRange();
  const starts: Boundary[] = [];
  const pieces: Piece[] = [];
  let previous: DOMRect | null = null;

  // A new line starts where a piece lands on a later line, lands entirely before the previous one
  // (the next column), or sits lower on the same line while back at the line start (after a
  // superscript). A raised or lowered inline box still overlaps its neighbours, so it is neither.
  const consider = (rect: DOMRect, boundary: Boundary) => {
    if (rect.width === 0 && rect.height === 0) {
      return;
    }

    if (previous) {
      const line = across(rect);
      const last = across(previous);
      const later = line.start >= last.end - SAME_LINE_TOLERANCE;
      const earlier = line.end <= last.start + SAME_LINE_TOLERANCE;
      const back = line.start > last.start + SAME_LINE_TOLERANCE && along(rect).start < along(previous).start - 1;

      if (later || earlier || back) {
        starts.push(boundary);
      }
    }

    previous = rect;
  };

  // The rows a set of rects sits on, in reading order, each with how far its rects reach along the
  // line. Rects that overlap across the line share a row: a first-letter box or a superscript is
  // taller or raised but still on its line, while two lines never overlap.
  const rowsOf = (rects: DOMRectList) => {
    const rows: Row[] = [];

    for (const rect of Array.from(rects)) {
      if (rect.width === 0 && rect.height === 0) {
        continue;
      }

      const span = along(rect);
      const band = across(rect);
      const row = rows.find((entry) => {
        const own = across(entry.rect);

        return band.start < own.end - SAME_LINE_TOLERANCE && band.end > own.start + SAME_LINE_TOLERANCE;
      });

      if (row) {
        row.start = Math.min(row.start, span.start);
        row.end = Math.max(row.end, span.end);
      } else {
        rows.push({ rect, start: span.start, end: span.end });
      }
    }

    return rows;
  };

  const measure = (text: Text, word: Segment) => {
    const start = word.index;
    const end = start + word.length;

    range.setStart(text, start);
    range.setEnd(text, end);

    const rows = rowsOf(range.getClientRects());

    if (rows.length === 0) {
      return;
    }

    word.first = rows[0];
    word.last = rows[rows.length - 1];

    if (rows.length === 1) {
      word.rect = rows[0].rect;
      word.size = rows[0].end - rows[0].start;

      // Grapheme extents are the distances between where consecutive graphemes start, the last one
      // reaching the word's end: engines round a lone grapheme's width, but its position is exact,
      // so the boxes tile the word exactly even where each rect alone would not.
      if (context.wrapChars) {
        const starts: number[] = [];

        for (const grapheme of graphemes(text.data.slice(start, end))) {
          range.setStart(text, start + grapheme.index);
          range.setEnd(text, start + grapheme.index + grapheme.length);

          const rect = range.getClientRects()[0];

          starts.push(rect ? along(rect).start : Number.NaN);
        }

        word.graphemeSizes = starts.map((at, index) => {
          const next = index + 1 < starts.length ? starts[index + 1] : rows[0].end;

          return Number.isNaN(at) || Number.isNaN(next) ? 0 : Math.max(0, next - at);
        });
      }

      consider(rows[0].rect, { text, offset: start, fragment: null });
      return;
    }

    // A word the browser broke inside (hyphenation, overflow-wrap). Each break is found with prefix
    // ranges: the shortest prefix that reaches a row starts that row with its last grapheme. The
    // graphemes' own rects are never trusted here, since around a hyphenation break Chrome reports
    // the grapheme after it on the line before, and Firefox the one before it on the line after.
    const list = Array.from(graphemes(text.data.slice(start, end)));

    const rowsOfPrefix = (count: number) => {
      const last = list[count - 1];

      range.setStart(text, start);
      range.setEnd(text, start + last.index + last.length);

      return rowsOf(range.getClientRects()).length;
    };

    consider(rows[0].rect, { text, offset: start, fragment: null });

    let from = 0;

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

      starts.push({
        text,
        offset: start + list[breaks].index,
        fragment: {
          start: start + list[from].index,
          extent: rows[row - 1].end - rows[row - 1].start,
          next: rows[row].end - rows[row].start,
        },
      });
      from = breaks;
    }

    previous = rows[rows.length - 1].rect;
  };

  const walk = (node: Node) => {
    if (node instanceof Text) {
      const plan: TextPlan = {
        node,
        words: Array.from(words(node.data)),
        decorated: context.wrapWords && node.parentElement ? carriesDecoration(node.parentElement, context) : false,
      };

      for (const word of plan.words) {
        measure(node, word);
      }

      // Boxing a word also boxes the space after it, which engines lay out wider than in a run;
      // the room the browser left between two words on a line is restated on that box instead.
      plan.words.forEach((word, index) => {
        const next = plan.words[index + 1];

        if (
          !word.last ||
          !next?.first ||
          Math.abs(across(word.last.rect).start - across(next.first.rect).start) > SAME_LINE_TOLERANCE
        ) {
          return;
        }

        // Two words with nothing between them (a script without spaces) have no space to box, so
        // the unit itself reaches to where the next one starts: positions stay absolute either way.
        if (word.index + word.length === next.index) {
          if (word.rect && word.first) {
            word.size = next.first.start - word.first.start;
          }
        } else {
          word.gap = next.first.start - word.last.end;
        }
      });

      if (plan.words.length > 0) {
        pieces.push({ text: plan });
      }

      return;
    }

    if (!(node instanceof Element) || node.tagName === "BR") {
      return;
    }

    const kind = classify(node, context);

    if (kind === "hidden" || kind === "float") {
      return;
    }

    if (kind === "inline") {
      for (const child of Array.from(node.childNodes)) {
        walk(child);
      }

      return;
    }

    const rect = node.getBoundingClientRect();

    // A box with no size (a <wbr>) is a break opportunity, not a piece.
    if (rect.width === 0 && rect.height === 0) {
      return;
    }

    consider(rect, { before: node });

    if (node instanceof HTMLElement && !(context.ignore && node.matches(context.ignore))) {
      pieces.push({ atom: node });
    }
  };

  for (const node of nodes) {
    walk(node);
  }

  // How far the first row of the run reaches along the line, over every word that sits on it.
  const firstRowEndOf = (): number => {
    const words = pieces.flatMap((piece) => ("text" in piece ? piece.text.words : []));
    const lead = words.find((word) => word.first)?.first;

    if (!lead) {
      return Number.NaN;
    }

    let end = Number.NEGATIVE_INFINITY;

    for (const word of words) {
      if (word.first && Math.abs(across(word.first.rect).start - across(lead.rect).start) <= SAME_LINE_TOLERANCE) {
        end = Math.max(end, word.first.end);
      }
    }

    return end;
  };

  // A floated first letter is a box the following lines flow around, and engines size that box
  // differently from a float with the same declarations (Firefox fits it to the glyph). Its used
  // size is read off the layout it produced: how far it pushes the first line's text, and the last
  // line it shortens; a bottom in the leading below that line shortens the same lines everywhere.
  const floatedFirstLetterBox = (): string => {
    const first = pieces[0];

    if (from !== 0 || !first || !("text" in first) || !first.text.words[0]?.rect) {
      return "";
    }

    const pseudo = getComputedStyle(container, "::first-letter");

    if (pseudo.getPropertyValue("float") === "none") {
      return "";
    }

    const word = first.text.words[0];
    const glyph = graphemes(first.text.node.data.slice(word.index, word.index + word.length)).next().value;

    if (!glyph || glyph.length >= word.length) {
      return "";
    }

    range.setStart(first.text.node, word.index + glyph.length);
    range.setEnd(first.text.node, word.index + word.length);

    const rest = range.getClientRects()[0];
    const box = container.getBoundingClientRect();

    if (!rest) {
      return "";
    }

    const contentAlong =
      along(box).start + Number.parseFloat(style.paddingInlineStart) + Number.parseFloat(style.borderInlineStartWidth);
    const contentAcross =
      across(box).start + Number.parseFloat(style.paddingBlockStart) + Number.parseFloat(style.borderBlockStartWidth);
    const offset = along(rest).start - contentAlong;
    const rows: { start: number; end: number; along: number }[] = [];

    for (const piece of pieces) {
      if (!("text" in piece)) {
        continue;
      }

      for (const entry of piece.text.words) {
        if (!entry.rect) {
          continue;
        }

        const rect = entry === word ? rest : entry.rect;
        const band = across(rect);
        const row = rows.find(
          (candidate) => band.start < candidate.end - SAME_LINE_TOLERANCE && band.end > candidate.start + SAME_LINE_TOLERANCE
        );

        if (row) {
          row.start = Math.min(row.start, band.start);
          row.end = Math.max(row.end, band.end);
          row.along = Math.min(row.along, along(rect).start - contentAlong);
        } else {
          rows.push({ start: band.start, end: band.end, along: along(rect).start - contentAlong });
        }
      }
    }

    let shortened = 0;

    while (shortened < rows.length && rows[shortened].along >= offset - 1) {
      shortened += 1;
    }

    const width = offset - Number.parseFloat(pseudo.marginLeft) - Number.parseFloat(pseudo.marginRight);
    const declarations = [`width:${width}px`];

    if (shortened > 0 && shortened < rows.length) {
      const bottom = (rows[shortened - 1].end + rows[shortened].start) / 2;

      declarations.push(`height:${bottom - contentAcross - Number.parseFloat(pseudo.marginTop)}px`);
    }

    return declarations.join(";");
  };

  // The whitespace between two text nodes of the run (around an inline element) is boxed like the
  // whitespace inside one: the room between the words on either side goes on whichever side holds
  // the whitespace, the following node first.
  pieces.forEach((piece, index) => {
    const next = pieces[index + 1];

    if (!("text" in piece) || !next || !("text" in next)) {
      return;
    }

    const a = piece.text;
    const b = next.text;
    const last = a.words[a.words.length - 1]?.last;
    const first = b.words[0]?.first;

    if (!last || !first || Math.abs(across(last.rect).start - across(first.rect).start) > SAME_LINE_TOLERANCE) {
      return;
    }

    // Only whitespace and the edges of inline elements may sit between the two: an ignored element
    // or an icon there is room of its own, not a space to box.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);

    walker.currentNode = a.node;

    for (let node = walker.nextNode(); node && node !== b.node; node = walker.nextNode()) {
      if (node instanceof Text ? node.data.trim() : classify(node as Element, context) !== "inline") {
        return;
      }
    }

    const gap = first.start - last.end;
    const lastWord = a.words[a.words.length - 1];
    const firstWord = b.words[0];
    const leads = firstWord.index > 0 && !b.node.data.slice(0, firstWord.index).trim();
    const trails =
      lastWord.index + lastWord.length < a.node.data.length && !a.node.data.slice(lastWord.index + lastWord.length).trim();

    if (leads) {
      b.leadGap = gap;
      a.trailGap = trails ? 0 : undefined;
    } else if (trails) {
      a.trailGap = gap;
    }
  });

  return {
    container,
    from,
    firstLetter: from === 0 ? firstLetterOf(container, style, pieces, floatedFirstLetterBox()) : null,
    firstLine: from === 0 ? firstLineOf(container, style) : "",
    firstRowEnd: firstRowEndOf(),
    anchor: container.childNodes[to] ?? null,
    starts,
    pieces,
    along,
    justify,
    indent,
    sink: emptySink(),
  };
}

/**
 * A `::first-letter` the container styles differently from its text. No browser can be trusted to
 * keep applying the pseudo once the first line is a nested block (Firefox never does, Chrome drops
 * it when the text node moves), and none applies it inside an inline-block unit, so the write
 * phase puts the same declarations on the glyph itself.
 */
/**
 * What a `::first-line` changes about the container's first line. Firefox drops the pseudo once
 * that line is a nested block, and no engine carries it into an inline-block unit, so the same
 * declarations go onto the first line block, where every unit inherits them.
 */
function firstLineOf(container: Element, style: CSSStyleDeclaration): string {
  const pseudo = getComputedStyle(container, "::first-line");

  return FIRST_LINE_PROPS.filter((prop) => pseudo.getPropertyValue(prop) !== style.getPropertyValue(prop))
    .map((prop) => `${prop}:${pseudo.getPropertyValue(prop)}`)
    .join(";");
}

function firstLetterOf(container: Element, style: CSSStyleDeclaration, pieces: Piece[], floatBox: string): FirstLetter | null {
  const first = pieces[0];

  if (!first || !("text" in first) || first.text.words.length === 0) {
    return null;
  }

  const pseudo = getComputedStyle(container, "::first-letter");
  const changed = (prop: string, unstyled: string) => pseudo.getPropertyValue(prop) !== unstyled;
  const declarations = [
    ...FIRST_LETTER_INHERITED.filter((prop) => changed(prop, style.getPropertyValue(prop))),
    ...Object.keys(FIRST_LETTER_INITIAL).filter((prop) => changed(prop, FIRST_LETTER_INITIAL[prop])),
  ].map((prop) => `${prop}:${pseudo.getPropertyValue(prop)}`);

  if (floatBox) {
    declarations.push(floatBox);
  }

  return declarations.length > 0 ? { declarations: declarations.join(";") } : null;
}

type Span = { start: number; end: number };

/**
 * Coordinates that read in writing order whatever the writing mode: `along` runs down a line,
 * `across` from one line to the next, both growing the way the text is read.
 */
function axes(style: CSSStyleDeclaration): { along: (rect: DOMRect) => Span; across: (rect: DOMRect) => Span } {
  const vertical = style.writingMode.startsWith("vertical") || style.writingMode.startsWith("sideways");
  const rtl = style.direction === "rtl";
  const leftward = style.writingMode.endsWith("-rl");
  const forward = (rect: DOMRect, horizontal: boolean): Span =>
    horizontal ? { start: rect.left, end: rect.right } : { start: rect.top, end: rect.bottom };
  const backward = (rect: DOMRect, horizontal: boolean): Span =>
    horizontal ? { start: -rect.right, end: -rect.left } : { start: -rect.bottom, end: -rect.top };

  if (vertical) {
    return {
      along: (rect) => (rtl ? backward(rect, false) : forward(rect, false)),
      across: (rect) => (leftward ? backward(rect, true) : forward(rect, true)),
    };
  }

  return {
    along: (rect) => (rtl ? backward(rect, true) : forward(rect, true)),
    across: (rect) => forward(rect, false),
  };
}

/** The read phase for a container: its runs, measured, and its block children, planned in turn. */
function planContainer(container: Element, context: Context): Item[] {
  const children = Array.from(container.childNodes);
  const items: Item[] = [];
  let runStart = -1;

  const endRun = (index: number) => {
    if (runStart >= 0) {
      const run = planRun(container, runStart, index, context);

      if (run) {
        items.push({ run });
      }

      runStart = -1;
    }
  };

  children.forEach((child, index) => {
    const element = child instanceof Element ? child : null;
    const kind = element && element.tagName !== "BR" ? classify(element, context) : "inline";

    if (element && kind !== "inline" && kind !== "float" && !isInlineLevel(displayOf(element, context))) {
      endRun(index);

      if (kind === "block" && element instanceof HTMLElement) {
        items.push({ block: element, items: planContainer(element, context) });
      } else if (kind === "atom" && element instanceof HTMLElement) {
        items.push({ atom: element });
      }

      return;
    }

    if (runStart < 0) {
      runStart = index;
    }
  });

  endRun(children.length);

  return items;
}

const emptySink = (): Sink => ({ lines: [], words: [], chars: [], masks: [] });

function wrapper(tag: "div" | "span", context: Context, css: string) {
  const el = document.createElement(tag);

  context.created.set(el, css);

  return el;
}

const sized = (size: number | undefined) => (size ? `;inline-size:${size}px` : "");

/** The hyphen a break drew, restated as a glyph in a box of the same width. */
function hyphenGlyph(width: number, context: Context) {
  const glyph = wrapper("span", context, `display:inline-block;inline-size:${width}px`);

  glyph.textContent = "-";

  return glyph;
}

/**
 * A fragment a break left at the end of a line, measured once the cut has made it the line's end:
 * the room it reached before, less its natural width now, is the hyphen the browser had drawn.
 */
function restateHyphen(pending: PendingHyphen, lines: HTMLElement[], along: (rect: DOMRect) => Span, context: Context) {
  // A fragment unit already has the row's whole extent as its box; the hyphen fills what the text
  // leaves of it.
  if (pending.unit) {
    const range = document.createRange();
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;

    range.selectNodeContents(pending.unit);

    for (const rect of Array.from(range.getClientRects())) {
      const span = along(rect);

      start = Math.min(start, span.start);
      end = Math.max(end, span.end);
    }

    const hyphen = pending.fragment.extent - (end - start);

    if (hyphen > 0.5) {
      pending.unit.append(hyphenGlyph(hyphen, context));
    }

    return;
  }

  // A lines-only cut: the fragment is the run of text that ends its line.
  const line = lines[pending.line];
  const walker = line ? document.createTreeWalker(line, NodeFilter.SHOW_TEXT) : null;
  let tail: Text | null = null;

  while (walker?.nextNode()) {
    if ((walker.currentNode as Text).data.trim()) {
      tail = walker.currentNode as Text;
    }
  }

  if (!tail) {
    return;
  }

  const range = document.createRange();

  range.setStart(tail, Math.max(0, tail.data.search(/\S+\s*$/)));
  range.setEnd(tail, tail.data.length);

  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;

  for (const rect of Array.from(range.getClientRects())) {
    const span = along(rect);

    start = Math.min(start, span.start);
    end = Math.max(end, span.end);
  }

  const hyphen = pending.fragment.extent - (end - start);

  if (hyphen > 0.5) {
    tail.after(hyphenGlyph(hyphen, context));
  }
}

function maskOf(unit: HTMLElement, tag: "div" | "span", css: string, sink: Sink, context: Context) {
  const mask = wrapper(tag, context, css);

  unit.replaceWith(mask);
  mask.append(unit);
  sink.masks.push(mask);

  return mask;
}

/** Splits a word into graphemes. Each keeps its painted extent, so the kerning lost between boxes moves nothing. */
function wrapWordChars(word: HTMLElement, decoration: string, sizes: number[] | undefined, sink: Sink, context: Context) {
  const text = word.textContent ?? "";
  let index = 0;

  word.textContent = "";

  for (const grapheme of graphemes(text)) {
    const size = sizes?.[index];
    const unit = wrapper("span", context, `display:inline-block;position:relative${sized(size)}${decoration}`);

    index += 1;

    unit.textContent = text.slice(grapheme.index, grapheme.index + grapheme.length);
    word.append(unit);
    sink.chars.push(unit);

    if (context.mask.has("chars")) {
      maskOf(unit, "span", `display:inline-block;position:relative;clip-path:inset(0)${decoration}`, sink, context);
    }
  }
}

/**
 * Replaces a text node with its words wrapped, spaces left as the text they were. A word a line
 * starts inside is cut into two units at the break, the first keeping the hyphen the browser drew,
 * so a line start always lands in front of a node and the cuts never have to split text again.
 * Returns the outermost node each line start now sits in front of.
 */
type PendingHyphen = { fragment: { start: number; extent: number }; unit: HTMLElement | null; line: number };

function wrapTextWords(
  plan: TextPlan,
  starts: Map<number, Boundary>,
  sink: Sink,
  pending: PendingHyphen[],
  context: Context
): Map<Boundary, Node> {
  const fragment = document.createDocumentFragment();
  const resolved = new Map<Boundary, Node>();
  const decoration = plan.decorated ? `;${INHERIT_DECORATION}` : "";
  const text = plan.node.data;
  let cursor = 0;

  const emit = (start: number, end: number, ends: Boundary | null, word: Segment) => {
    // A fragment of a broken word takes the room its row gave the word, hyphen included; the hyphen
    // restated inside it then fills the box rather than adding to it.
    const whole = start === word.index && end === word.index + word.length;
    const begins = starts.get(start);
    const size = whole
      ? word.size
      : ends && "text" in ends && ends.fragment
        ? ends.fragment.extent
        : begins && "text" in begins && begins.fragment
          ? begins.fragment.next
          : undefined;
    const unit = wrapper("span", context, `display:inline-block;position:relative${sized(size)}${decoration}`);

    unit.textContent = text.slice(start, end);
    fragment.append(unit);
    sink.words.push(unit);

    if (context.wrapChars) {
      wrapWordChars(unit, decoration, whole ? word.graphemeSizes : undefined, sink, context);
    }

    if (ends && "text" in ends && ends.fragment) {
      pending.push({ fragment: ends.fragment, unit, line: -1 });
    }

    const outer = context.mask.has("words")
      ? maskOf(unit, "span", `display:inline-block;position:relative;clip-path:inset(0)${decoration}`, sink, context)
      : unit;
    const boundary = starts.get(start);

    if (boundary) {
      resolved.set(boundary, outer);
    }
  };

  let last: Segment | null = null;

  const space = (between: string, size: number) => {
    const box = wrapper("span", context, `display:inline-block;inline-size:${size}px`);

    box.textContent = between;
    fragment.append(box);
  };

  for (const word of plan.words) {
    if (word.index > cursor) {
      const between = text.slice(cursor, word.index);
      const size = last ? last.gap : plan.leadGap;

      if (size !== undefined && !between.trim()) {
        space(between, size);
      } else {
        fragment.append(between);
      }
    }

    const end = word.index + word.length;
    let from = word.index;

    for (let offset = word.index + 1; offset < end; offset += 1) {
      const boundary = starts.get(offset);

      if (boundary && "text" in boundary) {
        emit(from, offset, boundary, word);
        from = offset;
      }
    }

    emit(from, end, null, word);
    cursor = end;
    last = word;
  }

  if (cursor < text.length) {
    const trailing = text.slice(cursor);

    if (plan.trailGap !== undefined && !trailing.trim()) {
      space(trailing, plan.trailGap);
    } else {
      fragment.append(trailing);
    }
  }

  plan.node.replaceWith(fragment);

  return resolved;
}

/** Where a boundary sits now: a character in a text node, or a child index in front of a node. */
function resolve(boundary: Boundary): { node: Node; offset: number } {
  if ("before" in boundary) {
    return { node: boundary.before.parentNode as Node, offset: childIndex(boundary.before) };
  }

  return { node: boundary.text, offset: boundary.offset };
}

/**
 * A boundary at the very start of an inline element is moved in front of that element, so the cut
 * takes the whole element with the new line instead of leaving an empty clone of it (an empty
 * `<a href>` is a tab stop with no name) at the end of the previous one.
 */
function lift(position: { node: Node; offset: number }, container: Element): { node: Node; offset: number } {
  let { node, offset } = position;

  while (node !== container) {
    const parent = node.parentNode;

    if (!parent) {
      break;
    }

    if (node instanceof Text) {
      if (offset > 0) {
        break;
      }
    } else if (!Array.from(node.childNodes).slice(0, offset).every(isBlank)) {
      break;
    }

    offset = childIndex(node);
    node = parent;
  }

  return { node, offset };
}

/** An empty element in a cut line is a clone the cut left behind, unless it was empty to begin with (a float, an icon box). */
function pruneEmpty(line: Element, context: Context) {
  // Reverse document order, so a parent is judged after the children that would empty it out.
  for (const el of Array.from(line.querySelectorAll("*")).reverse()) {
    if (context.originals.has(el) || context.created.has(el as HTMLElement)) {
      continue;
    }

    if (el.children.length === 0 && !el.textContent?.trim()) {
      el.remove();
    }
  }
}

/**
 * The write phase for one run: words and chars wrapped first (when asked for), then the lines cut
 * from the last backwards, so every earlier boundary stays valid while the DOM after it is lifted
 * out. Every cut ends at the container, after whatever the run still holds: an end inside an
 * inline element would split that element and leave its empty tail behind. A cut that starts
 * inside an inline element clones it for the new line, which is how a link keeps wrapping.
 */
function cutRun(run: RunPlan, context: Context) {
  const { container, sink } = run;
  const pending: PendingHyphen[] = [];
  let positions: { node: Node; offset: number }[];

  if (context.wrapWords) {
    const resolved = new Map<Boundary, Node>();

    for (const piece of run.pieces) {
      if ("text" in piece) {
        const starts = new Map<number, Boundary>();

        for (const start of run.starts) {
          if ("text" in start && start.text === piece.text.node) {
            starts.set(start.offset, start);
          }
        }

        for (const [start, node] of wrapTextWords(piece.text, starts, sink, pending, context)) {
          resolved.set(start, node);
        }
      } else {
        sink.words.push(piece.atom);

        if (context.wrapChars) {
          sink.chars.push(piece.atom);
        }
      }
    }

    positions = run.starts.map((start) => {
      const node = resolved.get(start);

      return node ? { node: node.parentNode as Node, offset: childIndex(node) } : resolve(start);
    });
  } else {
    positions = run.starts.map(resolve);

    run.starts.forEach((start, index) => {
      if ("text" in start && start.fragment) {
        pending.push({ fragment: start.fragment, unit: null, line: index });
      }
    });
  }

  const starts = [{ node: container as Node, offset: run.from }, ...positions.map((position) => lift(position, container))];
  const fragments: DocumentFragment[] = [];
  const range = document.createRange();
  const end = () => (run.anchor ? childIndex(run.anchor) : container.childNodes.length);

  for (let index = starts.length - 1; index >= 0; index -= 1) {
    range.setStart(starts[index].node, starts[index].offset);
    range.setEnd(container, end());
    fragments[index] = range.extractContents();
  }

  const nowrap = context.wrapWords ? ";text-wrap:nowrap" : "";

  fragments.forEach((fragment, index) => {
    // A block's last line is never justified, and every line is now a block's last line; its first
    // line is the only one indented, and every line is now a block's first line.
    const last = run.justify && index < fragments.length - 1 ? ";text-align-last:justify" : "";
    const unindented = run.indent && index > 0 ? ";text-indent:0" : "";
    const firstLine = run.firstLine && index === 0 ? `;${run.firstLine}` : "";
    const line = wrapper("div", context, `display:block;position:relative${nowrap}${last}${unindented}${firstLine}`);

    line.append(fragment);
    pruneEmpty(line, context);
    container.insertBefore(line, run.anchor);
    sink.lines.push(line);

    if (context.mask.has("lines")) {
      maskOf(line, "div", "display:block;position:relative;clip-path:inset(0)", sink, context);
    }
  });

  // The one read a cut allows itself, and only where a word was broken: the fragments no longer
  // break, so what each one lost against the room it had is the hyphen the browser drew.
  for (const entry of pending) {
    restateHyphen(entry, sink.lines, run.along, context);
  }

  if (run.firstLetter && sink.lines[0]) {
    context.firstLetters.push({ line: sink.lines[0], firstLetter: run.firstLetter });
  }

  if (run.firstLine && sink.lines[0] && Number.isFinite(run.firstRowEnd)) {
    context.firstLines.push({ line: sink.lines[0], declarations: run.firstLine, end: run.firstRowEnd, along: run.along });
  }
}

/**
 * A restated `::first-line` is only kept where it reproduces the painted row. An engine can report
 * a declaration on the pseudo that it never rendered (WebKit's `text-transform`), and one that
 * still applies the pseudo through the block would draw such a declaration twice; the properties
 * most likely to do that are dropped first, and the whole restatement last.
 */
function settleFirstLine(entry: Context["firstLines"][number]) {
  const reaches = () => {
    const range = document.createRange();
    let end = Number.NEGATIVE_INFINITY;

    range.selectNodeContents(entry.line);

    for (const rect of Array.from(range.getClientRects())) {
      end = Math.max(end, entry.along(rect).end);
    }

    return Math.abs(end - entry.end) <= 0.5;
  };

  if (reaches()) {
    return;
  }

  for (const prop of ["text-transform", "letter-spacing", "word-spacing", "font-weight"]) {
    if (entry.line.style.getPropertyValue(prop)) {
      entry.line.style.removeProperty(prop);

      if (reaches()) {
        return;
      }
    }
  }

  for (const declaration of entry.declarations.split(";")) {
    entry.line.style.removeProperty(declaration.split(":")[0]);
  }
}

/**
 * The first glyph gets the pseudo's declarations on a span of its own. The span is an inline-block,
 * so the container's pseudo, where a browser still applies it, cannot reach the glyph a second
 * time. A floated first letter (a drop cap) is out of flow, which would let the pseudo move on to
 * the next in-flow letter, so an empty atomic inline is put in front of it to be what the pseudo
 * sees first; and it is lifted out of a word or char unit, since a float inside an inline-block
 * would be contained by it instead of letting the following lines flow around it.
 */
function restateFirstLetter(line: HTMLElement, firstLetter: FirstLetter, context: Context) {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node instanceof Text && !node.data.trim()) {
    node = walker.nextNode();
  }

  if (!(node instanceof Text)) {
    return;
  }

  const start = node.data.search(/\S/);
  const unit = node.parentElement;
  const floated = /(?:^|;)float:(?!none)/.test(firstLetter.declarations);

  // A char split already has the glyph in a span of its own.
  if (unit && context.created.has(unit) && unit.hasAttribute("data-char") && !floated) {
    unit.style.cssText = `${unit.style.cssText};${firstLetter.declarations}`;
    return;
  }

  const grapheme = graphemes(node.data.slice(start)).next().value;

  if (!grapheme) {
    return;
  }

  const range = document.createRange();
  const glyph = document.createElement("span");

  range.setStart(node, start);
  range.setEnd(node, start + grapheme.length);
  range.surroundContents(glyph);
  glyph.style.cssText = `display:inline-block;${firstLetter.declarations}`;

  if (!floated) {
    return;
  }

  let outer: HTMLElement = glyph;

  while (outer.parentElement && outer.parentElement !== line && context.created.has(outer.parentElement)) {
    outer = outer.parentElement;
  }

  const blocker = document.createElement("span");

  blocker.style.display = "inline-block";
  line.insertBefore(glyph, outer === glyph ? glyph.nextSibling : outer);
  line.insertBefore(blocker, glyph);
}

/** The write phase for a container: runs cut last to first, block children written in turn, all merged in document order. */
function writeItems(items: Item[], into: Sink, context: Context) {
  for (const item of [...items].reverse()) {
    if ("run" in item) {
      cutRun(item.run, context);
    }
  }

  for (const item of items) {
    if ("run" in item) {
      into.lines.push(...item.run.sink.lines);
      into.words.push(...item.run.sink.words);
      into.chars.push(...item.run.sink.chars);
      into.masks.push(...item.run.sink.masks);
    } else if ("block" in item) {
      writeItems(item.items, into, context);
    } else {
      into.lines.push(item.atom);

      if (context.wrapWords) {
        into.words.push(item.atom);
      }

      if (context.wrapChars) {
        into.chars.push(item.atom);
      }
    }
  }
}

/** The selection hooks, written once per element: index attribute and property on every unit, counts on the target. */
function mark(split: TextSplit, options: SplitOptions, context: Context) {
  const levels: SplitLevel[] = ["lines", "words", "chars"];
  const indexes = new Map<HTMLElement, string[]>();

  const note = (el: HTMLElement, property: string) => {
    const list = indexes.get(el);

    if (list) {
      list.push(property);
    } else {
      indexes.set(el, [property]);
    }
  };

  for (const level of levels) {
    context.target.style.setProperty(`--${level}`, String(split[level].length));

    split[level].forEach((unit, index) => {
      unit.setAttribute(`data-${UNIT_ATTRIBUTE[level]}`, String(index));
      note(unit, `--${UNIT_ATTRIBUTE[level]}:${index}`);

      if (options.classes?.[level]) {
        unit.classList.add(options.classes[level]);
      }
    });
  }

  split.masks.forEach((mask, index) => {
    mask.setAttribute("data-mask", String(index));

    if (options.classes?.mask) {
      mask.classList.add(options.classes.mask);
    }
  });

  for (const [el, css] of context.created) {
    el.style.cssText = [css, ...(indexes.get(el) ?? [])].join(";");
  }

  // A piece kept whole keeps its own styles; only the index joins them.
  for (const [el, properties] of indexes) {
    if (!context.created.has(el)) {
      for (const property of properties) {
        const [name, value] = property.split(":");

        el.style.setProperty(name, value);
      }
    }
  }

  for (const el of context.inheritors) {
    for (const prop of DECORATION_PROPS) {
      el.style.setProperty(prop, "inherit");
    }
  }

  if (context.targetDecoration) {
    for (const declaration of context.targetDecoration) {
      const [name, value] = declaration.split(/:(.*)/s);

      context.target.style.setProperty(name, value);
    }
  }

  context.target.setAttribute("data-split", levels.filter((level) => split[level].length > 0).join(" "));
}

/** Splits `target` into painted lines, and words and graphemes inside them, in document order. */
export function splitText(target: HTMLElement, options: SplitOptions = {}): TextSplit {
  splits.get(target)?.revert();

  const original = target.innerHTML;
  const originalMarker = target.getAttribute("data-split");
  const levels = new Set(options.type ?? ["lines"]);
  const split: TextSplit = {
    lines: [],
    words: [],
    chars: [],
    masks: [],
    revert: () => {
      target.innerHTML = original;

      if (originalMarker === null) {
        target.removeAttribute("data-split");
      } else {
        target.setAttribute("data-split", originalMarker);
      }

      for (const level of ["lines", "words", "chars"]) {
        target.style.removeProperty(`--${level}`);
      }

      for (const prop of DECORATION_PROPS) {
        target.style.removeProperty(prop);
      }

      splits.delete(target);
    },
  };

  const context: Context = {
    target,
    wrapWords: levels.has("words") || levels.has("chars"),
    wrapChars: levels.has("chars"),
    mask: new Set(options.mask === undefined ? [] : [options.mask].flat()),
    ignore: options.ignore,
    kinds: new Map(),
    displays: new Map(),
    decorations: new Map(),
    inheritors: new Set(),
    targetDecoration: null,
    created: new Map(),
    originals: new Set(target.querySelectorAll("*")),
    firstLetters: [],
    firstLines: [],
  };

  const items = planContainer(target, context);

  writeItems(items, split, context);
  mark(split, options, context);

  for (const { line, firstLetter } of context.firstLetters) {
    restateFirstLetter(line, firstLetter, context);
  }

  for (const entry of context.firstLines) {
    settleFirstLine(entry);
  }

  splits.set(target, split);

  return split;
}
