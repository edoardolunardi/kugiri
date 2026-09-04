# kugiri

Splits text into lines, words and characters exactly where the browser already broke it.

**Demo:** <https://edoardolunardi.github.io/kugiri/>

区切り (kugiri) is the point where one segment ends and the next begins. That is what this
library finds: the line boxes the browser painted, the words and graphemes inside them, and nothing
else. It cuts the DOM at those points and marks every unit so you can animate it, in CSS or in
script. It never decides where a line should break; the browser did that already.

- **Keeps the paint.** Lines are read off the text with `Range.getClientRects()`, not predicted, so
  `text-wrap: balance`, authored newlines, `<br>`, right-to-left text, scripts without spaces,
  hyphenation, `overflow-wrap`, `text-indent`, floats, multi-column layout and vertical writing all
  come out as painted. Words and characters are wrapped inside those lines under
  `text-wrap: nowrap`, so their boxes can never move a wrap.
- **Handles whatever is in the text.** Links and marks are cloned per line the way the spec
  defines. Block containers are split inside themselves, so lists keep their numbers. Only text is
  split: an inline piece that is not text (an icon, a chip, anything you ask it to ignore) rides
  along whole inside its line, and a block-level one (an image, a button row, a table) is left
  exactly where it is and is never a unit. Hidden content is left alone. Underlines are carried
  onto word and character units and still follow the link's hover.
- **Owns nothing but the split.** Every unit gets `data-line`, `data-word` or `data-char` with its
  index, the same index as a custom property, and a mask wrapper if you want one. Animate with the
  Web Animations API, GSAP, Motion, or a stylesheet. A split is a snapshot of one layout: nothing
  watches the viewport or splits again on its own, and [that part is yours](#a-split-is-a-snapshot).
- **Cheap.** One read phase, one write phase, no forced reflow. A 2,000-word article splits into
  lines in about 10ms on a laptop.
- **Small.** One file, ES2022, no dependencies. About 6.8 kB minified and gzipped (18.5 kB
  minified, 6.1 kB with brotli).

## Install

```sh
npm install kugiri
```

## Use

```ts
import { splitText } from "kugiri";

const target = document.querySelector("h1");
const split = splitText(target, { type: ["lines"], mask: "lines" });

const reveal = split.lines.map((line, index) =>
  line.animate([{ transform: "translateY(100%)", opacity: 0 }, { transform: "none", opacity: 1 }], {
    duration: 1000,
    delay: index * 100,
    easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    fill: "backwards", // hidden until its turn, at rest when done
  })
);

// A mask clips at rest too (descenders, focus rings), so drop the clip once the reveal is over.
await Promise.all(reveal.map((animation) => animation.finished));

for (const mask of split.masks) {
  mask.style.clipPath = "none";
}

// Later, to put the original markup back:
split.revert();
```

### With CSS only

The split writes the index of every unit as a custom property, so a stylesheet can run the whole
reveal and the script only has to split and set one attribute. Read `--line` or `--char` the same way
to stagger lines or characters.

```ts
splitText(target, { type: ["words"] });
target.dataset.revealed = "";
```

```css
[data-word] {
  opacity: 0;
  transform: translateY(0.6em);
}

[data-revealed] [data-word] {
  animation: rise 0.8s cubic-bezier(0.23, 1, 0.32, 1) forwards;
  animation-delay: calc(var(--word) * 30ms);
}

@keyframes rise {
  to {
    opacity: 1;
    transform: none;
  }
}
```

### A split is a snapshot

kugiri is a split engine and nothing more. A split is the layout the text had at the moment it ran.
It does not watch the viewport, the fonts, the text or the container, and it never splits again on
its own. When the box the text wraps in changes width, the lines it was cut into are no longer the
lines the browser would paint, and it is your code that reverts and splits again.

None of this ships with the library. The example below is one way to do it, not an API: it watches
the target's inline size, folds the stream of changes a drag produces into one split per frame, and
ignores height changes, which move no wrap (a phone's address bar collapsing on scroll is one). The
demo does the same for its fifty cases with a short timeout in place of the frame:

```ts
import { splitText } from "kugiri";

const target = document.querySelector("h1");
let split = splitText(target, { type: ["lines"] });
let width = target.clientWidth;
let frame = 0;

new ResizeObserver(() => {
  if (target.clientWidth === width) {
    return;
  }

  width = target.clientWidth;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    split.revert();
    split = splitText(target, { type: ["lines"] });
  });
}).observe(target);
```

The same holds for anything else that moves a wrap. Split after the fonts the text is set in have
loaded (`await document.fonts.ready`), and split again after the text or its styles change. Whether
to replay the reveal after a resize or to show the units at rest is a choice the split leaves to
you; the demo splits again with no reveal, so the text stays responsive and nothing plays twice.

## API

### `splitText(target, options?)`

Splits `target` in place and returns a `TextSplit`.

| Option    | Type                                      | Default     | What it does                                                                                                             |
| --------- | ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `type`    | `("lines" \| "words" \| "chars")[]`       | `["lines"]` | The units to produce. Words and chars always sit inside lines, so `lines` comes with them.                              |
| `mask`    | `SplitLevel \| SplitLevel[]`              | none        | The units that get a clipping wrapper (`clip-path: inset(0)`, set inline) to slide out from under. Any levels, whatever the unit you animate. The clip stays until you clear it. |
| `ignore`  | `string`                                  | none        | A selector for elements to leave whole: never cut into, never wrapped, never a unit.                                    |
| `classes` | `{ lines?, words?, chars?, mask? }`       | none        | Class names to add to the units and masks, on top of the data attributes they always carry.                             |

### `TextSplit`

| Field    | Type            | What it holds                                                                                        |
| -------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| `lines`  | `HTMLElement[]` | One block per painted line of text, in document order.                                               |
| `words`  | `HTMLElement[]` | Inline-block units, one per word, punctuation attached. Empty unless `type` includes words or chars. |
| `chars`  | `HTMLElement[]` | Inline-block units, one per grapheme cluster. Empty unless `type` includes chars.                    |
| `masks`  | `HTMLElement[]` | The clip wrappers, if any.                                                                           |
| `revert` | `() => void`    | Puts the original markup back.                                                                       |

### Hooks written on the DOM

| Where      | Attribute                                      | Custom property                     |
| ---------- | ---------------------------------------------- | ----------------------------------- |
| Each unit  | `data-line`, `data-word`, `data-char` (index)  | `--line`, `--word`, `--char` (index) |
| Each mask  | `data-mask` (index)                            |                                     |
| The target | `data-split` (the levels present)              | `--lines`, `--words`, `--chars` (counts) |

Indexes count in document order, so `calc(var(--word) * 30ms)` is a stagger and
`calc((var(--words) - var(--word)) * 30ms)` a reversed one.

### What a unit is

Content is classified by how it lays out, not by tag:

- **Inline elements** (`a`, `em`, `strong`, spans, an inline custom element) are cut into. One that
  wraps across lines is cloned per line, attributes included.
- **Block containers** (`p`, `li`, headings, `blockquote`) are split inside themselves, so a list
  keeps its markers and numbers.
- **Everything else with content** is one piece, never cut into: replaced elements, inline-blocks,
  ruby, flex and grid rows, tables, list items with an inside marker (a `summary`), custom elements
  that are boxes of their own, and anything matching `ignore`. An inline-level piece rides along
  inside its line and, unless it matches `ignore`, counts as one word. A block-level piece is not
  text: it is left exactly where it is and is not a unit at all, so a table or a button row is never
  revealed as if it were a line.
- **Floats** are not text, so they are not units and nothing animates them: a float is put back in
  front of the line block it floated beside, at the same top, so the lines after it are still
  shortened by it exactly as painted.
- **A `::first-line` style** is restated on the first line block, so it survives the cut and reaches
  the units inside it.
- **A styled `::first-letter`** (a big initial, a floated drop cap) is restated on the glyph itself,
  because no browser keeps applying the pseudo once the first line is a block of its own, and none
  applies it inside a word or character unit. A floated drop cap is then a float like any other: it
  sits in front of the first line block, unclipped and unanimated, and the lines flow around it.
- **Hidden content** (a closed `details` body, `display: none`) is left exactly as it is.

## Caveats

- A character split loses the kerning between letters. Every splitter does; it is inherent to
  wrapping each glyph in its own box.
- `revert()` restores the original markup, so state or listeners added inside the target between
  split and revert are lost, and an inline element with an `id` is duplicated while it wraps across
  lines.
- The split reads `Intl.Segmenter` for words and graphemes (Chrome 87, Safari 14.1, Firefox 125).
  Without it, words fall back to whitespace and graphemes to code points, which breaks emoji
  sequences apart.
- Screen readers may read a character split letter by letter. If you split a heading into
  characters, give the target an `aria-label` with its text and `aria-hidden` on the units.
- Word and character units are boxes, and a box cannot be shaped across its edges, so the split
  restates each unit's painted width and the painted gap between units. In Chromium and Firefox the
  result is exact to the sub-pixel; WebKit reports its measurements rounded, so a line can end
  within about a pixel of where it was.
- WebKit renders a `::first-line` without the `text-transform` it reports, then applies it once an
  animation has touched the line. The split verifies a restated first line against the painted row
  and drops what does not reproduce it, but a transformed `::first-line` is the one case to check by
  eye in Safari.

## Demo

The demo is live at <https://edoardolunardi.github.io/kugiri/>.

`npm run dev` opens the demo, which is also the test suite: fifty cases, each split as it
scrolls into view. **Check lines** compares every split with the lines the browser painted before
the split, text and geometry. **Boxes** outlines every line, word, character and mask the split
made, so you can see what it produced. The page reveals with the Web Animations API and reverts and
splits every case again when its column changes width, with no reveal a second time, the way a
consumer has to; its header shows the code for both, and for the same reveal in CSS only, as examples
that are not part of the library.
`npm test` runs the same check headless in Chromium, WebKit and Firefox.

## Development

```sh
npm install          # also installs the git hooks
npm run dev          # the demo on http://localhost:4173
npm run check        # types and lint
npm run format       # Biome, with fixes
npm test             # Playwright against the demo
npm run build        # dist/, from tsc
npm run build.demo   # dist-demo/, the static demo published to GitHub Pages
npm run release -- patch|minor|major   # changelog, size, version, tag, push; CI publishes
```

Commits follow Conventional Commits and are checked by a hook. A release is one command: it rolls
the changelog's Unreleased section into a dated version, restates the size above, bumps, tags and
pushes; the tag then runs a workflow that publishes to npm through trusted publishing and lists
the GitHub release. Try it with `--dry-run` first. Instructions for agents live in `AGENTS.md`
and `.agents/skills/`.

## License

MIT
