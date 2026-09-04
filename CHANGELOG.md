# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-09-04

### Added

- `mask` takes an object naming, per level, how far the clip reaches past the box across
  the line: `mask: { lines: ".25em" }`. Display type set tighter than its glyph boxes
  leaves descenders and accents outside the line box, and a clip at the box cuts them
  until it is dropped; a reach keeps them in the window with no change to layout, since it
  is a negative inset on the clip itself. Read the clip back off the mask's inline style
  to restore it after clearing it.

## [0.2.1] - 2026-09-04

### Fixed

- Lines set tighter than their glyph boxes (a display heading at `line-height: 0.85`,
  or any leading below the font's content area) no longer merge into one line. A rect
  joins the row its centre falls in, where it used to join any row it overlapped, and
  consecutive rows of tight type overlap by a few pixels.

### Added

- The demo outlines every line, word, character and mask on request, from a
  **Boxes** control in the panel, so what the split produced is visible on the
  page.
- The demo's header shows the CSS-only reveal next to the scripted one: the
  stylesheet that staggers off the index the split writes, and the two lines of
  script it needs.

### Changed

- The demo page reads as a specimen book: the cases sit in named groups with a
  table of contents that stays in view, every case shows its id and what it asks
  of the split, and the controls sit in one panel that keeps out of the text.
  The page is set in Geist and Geist Mono, self-hosted as variable faces. It
  reverts and splits every case again when its column changes width, with no
  reveal a second time, the way a consumer of the library has to, and its
  header shows the code for the reveal and for the resize, in plain browser
  APIs. The README now says so too: a split is a snapshot of one layout, and
  nothing animates it or watches for the next one.

- Releases publish from GitHub Actions. `npm run release` now ends by pushing
  the tag, and the Release workflow publishes to npm through trusted publishing,
  with provenance, and lists the GitHub release; no npm login or one-time
  password is needed on the machine that cuts the release.

## [0.2.0] - 2026-09-03

### Added

- `npm run release -- patch|minor|major`: one command that rolls this changelog,
  restates the size in the README and the demo, bumps, tags, pushes, publishes to
  npm and opens a GitHub release. `AGENTS.md` and `.agents/skills/` document how to
  develop, test and release the library.

### Changed

- Only text is split. A block-level piece that is not running text (a media
  tile, a button row, a table, a box-like custom element, a `summary`, a block
  matching `ignore`) used to be one unmasked line, and was revealed as if it
  were text; it is now left exactly where it is and is not a unit at all, so
  `lines`, `words` and `chars` hold text units only. An inline-level piece
  still rides along inside its line and still counts as one word.
- A float is no longer left inside the line block the cut dropped it in, where
  the line's animation carried it along. It is put back in front of the block
  of the line it floated beside, at the same top, so the lines still flow
  around it as painted and nothing animates it.
- A floated drop cap (a `::first-letter` with `float`) is a float like any
  other: its restated glyph now sits in front of the first line block instead
  of inside it, where the line's mask clipped it to one line's height during
  the reveal and the line's animation moved it.
- A word or char split of a paragraph with a floated drop cap no longer widens
  the first word by the glyph's box: the word is measured without the glyph,
  the glyph has no extent among the graphemes, and the char unit it leaves is
  dropped rather than kept as an empty unit.
- A run with nothing to split (a lone float, an ignored element, a `<br>`) is
  left exactly as it is instead of becoming an empty line.

## [0.1.0] - 2026-09-03

### Added

- `splitText(target, options)`: splits a target into painted lines, and words and
  graphemes inside them, without changing how the text wraps.
- Line detection off the browser's own line boxes, so `text-wrap: balance`,
  `pre-line`, `<br>`, right-to-left text, scripts without spaces, hyphenation,
  `overflow-wrap`, `text-indent`, floats, multi-column layout and vertical
  writing modes all come out as painted.
- Content classification by layout: block containers are split inside
  themselves, pieces that are not running text (media, button rows, tables,
  box-like custom elements, ignored elements) ride along whole, hidden content
  is left alone.
- Text decorations carried onto word and character units, so underlined links
  keep their rule and follow hover.
- A styled `::first-letter` restated on the glyph and a `::first-line` on the
  first line block, so big initials, floated drop caps and first-line styles
  survive the split in every browser.
- Word and character units, and the gaps between them, sized to their painted
  extents, so boxing the text moves nothing.
- A hyphen the browser drew at a break restated in a box of the same width.
- Verified in Chromium, Firefox and WebKit through the demo's own check.
- Selection hooks on every unit (`data-line`, `data-word`, `data-char`,
  `data-mask`, `--line`, `--word`, `--char`) and on the target (`data-split`,
  `--lines`, `--words`, `--chars`), plus optional class names.
- A framework-free demo page with a check that compares every split with the
  lines the browser painted, text and geometry.
