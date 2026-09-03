# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
