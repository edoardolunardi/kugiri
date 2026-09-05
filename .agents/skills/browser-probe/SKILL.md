---
name: browser-probe
description: Inspect what the split actually produced in a real browser: markup, unit widths, rects before and after, in Chromium, WebKit and Firefox. Use when a demo case fails, when a change to src/index.ts needs verifying beyond the suite, or when a layout question cannot be answered by reading code.
---

# Probe a split in a browser

The suite says pass or fail. For a first look, open the demo (`npm run dev`) and turn on the
**Masks** toggle in the panel: an outline around every mask, one around every unit, shows what the
split produced and where it stops matching the paint. To see why, or to verify geometry the
suite does not assert, run a throwaway Playwright spec against the demo page. The demo exposes its
harness on the window:

```ts
window.kugiriDemo = { demo, paintedLines, splitText };
```

- `splitText(target, options)` is the library.
- `paintedLines(target, relativeTo = target, ignore?)` reads the painted lines of an unsplit
  target the way the check does: line texts, where each line ends, the target's height.
- `demo.reveals` holds one entry per case (`target`, `split`, `expected`), and `demo.observer` is
  the IntersectionObserver that splits targets as they scroll into view.

## The pattern

Write the spec under `tests/` with a `tmp-` prefix, run it, read the report, delete it. Never
commit it.

```ts
import { expect, test } from "@playwright/test";

test("probe", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-readout]")).not.toHaveText(/targets 0/);

  const report = await page.evaluate(() => {
    const { splitText, demo, paintedLines } = (window as any).kugiriDemo;
    const target = document.querySelector<HTMLElement>("#drop-cap [data-target]")!;

    // A clean state: the demo may have split this target already, and a revert replaces every
    // node, so references taken before it go stale. Stop the demo from splitting it again.
    demo.observer.unobserve(target);
    splitText(target, { type: ["lines"] }).revert();

    const before = paintedLines(target);
    const split = splitText(target, { type: ["words"], mask: "words" });
    const after = split.lines.map((line: HTMLElement) => paintedLines(line, target));

    return JSON.stringify({
      html: split.lines[0].outerHTML.slice(0, 400),
      units: split.words.slice(0, 4).map((u: HTMLElement) => [u.textContent, u.getBoundingClientRect().width]),
      endDeltas: before.ends.map((e: any, i: number) => {
        const m = after[i]?.ends.at(-1);
        return m ? [+(m.x - e.x).toFixed(2), +(m.y - e.y).toFixed(2)] : null;
      }),
    });
  });

  console.log(`REPORT ${report}`);
});
```

```sh
npx playwright test tests/tmp-probe.spec.ts --project=chromium --project=webkit --project=firefox --reporter=line 2>&1 | grep -o "REPORT .*\|Error.*"
rm tests/tmp-probe.spec.ts
```

The dev server starts on its own (Playwright's `webServer`). One `REPORT` line prints per browser,
in the order the projects finish.

## Rules of thumb

- **Return a string.** `page.evaluate` serialises its result; DOM nodes and DOMRects do not
  survive. Build plain arrays and numbers, round with `toFixed`, `JSON.stringify` at the end.
- **Measure before and after in the same evaluate call.** A layout read between the two is fine
  here; this is a probe, not the library.
- **Always start from a clean state** with `unobserve` and a `revert`, as above. Comparing a
  target the demo already split against stale node references produces nonsense such as a float
  that "moved" hundreds of pixels.
- **Compare like with like.** A range rect of a pseudo-styled character is not the box of the
  span that restates it. When two placements have to be compared, move the same element between
  them inside the probe and measure it twice.
- **Three browsers, always.** WebKit rounds rects; Firefox sizes floats and first letters
  differently from Chromium. A change that is right in one engine is not done.
- **Blank output means the probe threw.** Drop the `grep` to read the error.
