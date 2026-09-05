---
name: library-change
description: The checklist for changing the library in src/index.ts, from the demo case through the docs. Use for any feature, fix or refactor of the split itself, so the invariants, the suite, the README contract, the changelog and the stated size all stay true.
---

# Change the library

`src/index.ts` is the whole library. A change to it is done when the case shows it, the suite
passes in three browsers, the README says it and the changelog records it.

## 1. Start from the case

Every behaviour has a `<section data-case>` in `demo/index.html`. Find the one that shows the
situation, or add one (skill `demo-case`). Run it before touching the code, so the failure or the
current output is known:

```sh
npx playwright test --project=chromium
```

## 2. Keep the two phases apart

Reads first, writes after, never interleaved. Every `getComputedStyle`, `getBoundingClientRect`
and `getClientRects` belongs in `planContainer` and `planRun`, on a layout nothing has touched. The
plan they produce (`Item`, `RunPlan`, `Segment`, `Boundary`) carries everything the write phase
needs. `writeItems`, `cutRun`, `wrapTextWords`, `restateFirstLetter` and `mark` only write.

If a change needs a read after a write, say so in a comment the way `splitText` does for the
hyphens, and make it a single read at the end, after every target's writes, not one per unit.

## 3. Respect what a unit is

The README section "What a unit is" is the contract. Inline elements are cut into; block
containers are split inside themselves; everything else is one piece. Only text is split: a
block-level piece and a float are never units, an inline-level piece is one word, hidden content
is untouched. A change that moves a case between these categories changes the contract and needs
the README and a changelog line.

Whatever the split writes must not move a wrap. Word and char units are inline-blocks inside
`text-wrap: nowrap` lines with their painted extent restated (`inline-size`), and the painted gap
between words restated on the space between them. A new kind of unit or wrapper needs the same
treatment, or the geometry check fails by fractions of a pixel in WebKit first.

## 4. Write comments in the file's voice

Comments explain why in full sentences, name the browser behaviour they answer to, and avoid
restating the code. No em dashes.

## 5. Verify

```sh
npm run check    # types and lint
npm test         # Chromium, WebKit, Firefox
```

Both must pass. When the suite passes but the question is what the DOM looks like, or whether a
float or glyph kept its place to the pixel, use the `browser-probe` skill. A behaviour verified in
one engine is not verified.

## 6. Record it

- `README.md`: the feature bullets at the top and "What a unit is" if the contract moved; the
  caveats if a limitation appeared.
- `CHANGELOG.md`: a line under `## [Unreleased]`, in the past tense of what changed for a user of
  the library, under `### Added`, `### Changed`, `### Fixed` or `### Removed`.
- Demo copy: the `case-expect` of every case whose behaviour changed.
- Size: the README and the demo header state the built size. `npm run size` prints the gzipped
  bytes; the release script restates all three figures, so between releases they may drift by a
  tenth. A change that adds more than a few hundred gzipped bytes deserves a second look at
  whether it earns them.

## 7. Commit

Conventional Commits, header at most 72 characters, body explaining why. The hooks lint staged
files and the message. Do not commit or push unless asked.

A pull request follows `.github/PULL_REQUEST_TEMPLATE.md`, section by section, with every box of the
checklist ticked. The Pull request workflow checks the description against the template and fails
on a missing or empty section, a placeholder or an unticked box; run the same check by hand with
`node scripts/pull-request.mjs body.md`.
