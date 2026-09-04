---
name: demo-case
description: Add or change a case in the demo page, which is the test suite. Use whenever a behaviour of the split needs a test, a regression needs reproducing, or an existing case's copy or markup has to change.
---

# Add or change a demo case

The demo page is the test suite. Every behaviour of the library has one `<section data-case>` in
`demo/index.html`; `npm test` opens the page, splits every case as it scrolls into view, and asserts
that each case's check reads ok in Chromium, WebKit and Firefox. A behaviour without a case is
untested.

## The markup

```html
<section data-case="drop-cap-words" data-unit="words">
  <div><h3 class="case-title">Drop cap, split=words</h3><p class="case-expect">What must hold, in one or two sentences.</p><p class="case-result"></p></div>
  <div class="sample"><p class="body measure drop-cap" data-target>Copy long enough to wrap at least twice.</p></div>
</section>
```

- `data-case` is the id: lowercase, hyphens, unique. It becomes the section's `id` and its link in
  the nav, so a probe can find the target with `#drop-cap-words [data-target]`.
- `data-unit` is the level the case animates and splits into: `lines` (default), `words` or `chars`.
- `data-mask` is the level that gets the clipping wrapper: `none`, or one or more levels separated
  by spaces. Left out, the unit itself is masked.
- `data-ignore` is passed as the `ignore` selector.
- `data-reveal="css"` leaves the animation to the stylesheet (see `.css-reveal` in `demo/demo.css`).
- `data-target` marks the element that is split. One per section: the harness takes the first.
- The `case-expect` copy says what the reader should see and what the check asserts. Keep it in the
  voice of the existing cases: plain sentences, no em dashes.
- Put the section inside the matching `<section data-group>` (`lines`, `words-chars`, `links`,
  `rich`, `breaking`, `scripts`, `floats`, `scale`). The group's `h2` is its entry in the table of
  contents; the case's title, id and tags (unit, mask, ignore, css reveal) are read off the section
  by the harness and shown under the title, so nothing else has to be written.

Reuse the classes in `demo/demo.css` for the copy: `body` with `measure` (60ch) or `narrow`,
`headline`, `title`, `subtitle`, plus modifiers such as `justify`, `indent`, `drop-cap`,
`first-letter`, `first-line`, `hyphens`, `anywhere`, `pre-line`, `pre-wrap`, `columns`, `vertical`.
Add a class to `demo.css` only when a case needs a situation no class produces yet.

The copy is set in type on purpose: it is the same specimen sentence in most cases, so a reader
compares situations, not text. Use it unless the case is about the text itself (a script, emoji,
a long word).

## What the check asserts

`demo/demo.ts` reads the painted lines of every target before any split, then after the split
compares:

- **text**: the split lines cover the painted lines in order (`coversPainted`). Spacing and a
  trailing hyphen are ignored. The text of a float the split put in front of a line counts with
  that line. Block-level pieces the split never touches (a table, a button row) are skipped on
  both sides.
- **geometry**: the target is as tall as before (within 1px) and every line still ends where it
  did (within 1.5px on either axis; WebKit reports rounded rects).

A case whose geometry a browser is known to change after the split, for reasons outside the
split, is listed in `GEOMETRY_KNOWN_TO_DRIFT` in `tests/demo.spec.ts`, per browser. Add to that
list only with a comment saying why, and only for geometry: the lines themselves are always
asserted.

## Run it

```sh
npm test                                   # all cases, three browsers
npx playwright test --project=chromium     # one browser, faster while iterating
npm run dev                                # then open http://localhost:4173, scroll, click Check lines
```

A failing case prints `painted N lines, split M` with both line lists, or `N lines as painted, but
line K moved by x, y`. The **Boxes** toggles in the panel outline every line, word, character and
mask, which is the quickest look at what the split produced; for numbers, use the `browser-probe`
skill.
