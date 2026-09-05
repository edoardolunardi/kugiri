# Working on kugiri

kugiri splits text into lines, words and characters exactly where the browser already broke it.
The whole library is one file, `src/index.ts`, with no dependencies. The demo page is the test
suite. This file is the one place agents read instructions from; the skills under
`.agents/skills/` hold the step-by-step procedures it points to.

## Layout

| Path                   | What it is                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `src/index.ts`         | The library. Built by `tsc` into `dist/`, which is what npm ships.                         |
| `demo/index.html`      | Every behaviour as a case: one `<section data-case>` per situation running text can be in. |
| `demo/demo.ts`         | The harness: splits each case as it scrolls into view and checks it against the paint.     |
| `demo/demo.css`        | The demo's styles: the classes cases rely on (`measure`, `narrow`, `drop-cap`), the masks. |
| `tests/demo.spec.ts`   | Playwright: opens the demo, reveals everything, asserts every case's check reads ok.       |
| `scripts/release.mjs`  | The release, in one command, up to the tag push. `size.mjs` and `notes.mjs` serve it.      |
| `.github/workflows/`   | `pull-request.yml` and `pull-request-description.yml` check every pull request; `pages.yml` publishes the demo on every push to main; `release.yml` publishes a tag to npm. |
| `.github/ISSUE_TEMPLATE/` | The forms an issue is opened with: a bug report and a feature request. One required field each; the rest are hints at what helps. |
| `.github/PULL_REQUEST_TEMPLATE.md` | The sections every pull request description must have. `scripts/pull-request.mjs` checks a description against it. |
| `.agents/skills/`      | Procedures: adding a case, probing a split in a browser, changing the library, releasing.  |

## Commands

```sh
npm run dev          # the demo on http://localhost:4173
npm run check        # tsc and Biome lint
npm run format       # Biome, with fixes
npm test             # Playwright against the demo, in Chromium, WebKit and Firefox
npm run build        # dist/
npm run size         # minified and gzipped bytes of the build
npm run release -- patch|minor|major   # see .agents/skills/release
```

## How the library works, and what must stay true

- **Two phases, never interleaved.** Every layout and style read happens first, against a layout
  that is still clean; every DOM write happens after. A read between writes forces a reflow and is
  a regression even when the output is right. `planContainer` and `planRun` read; `writeItems`,
  `cutRun` and the restatements write. The one exception is documented in `cutRun`: measuring a
  hyphen after the cut.
- **The browser decides where lines break.** Lines are read off the text with
  `Range.getClientRects()` and cut with `Range.extractContents()`. Nothing about the layout may
  change before it is measured, and nothing the split writes may move a wrap: word and char units
  are inline-blocks inside `text-wrap: nowrap` lines, sized to their painted extents, with the
  painted gap restated between them.
- **Only text is split.** Content is classified by how it lays out, not by tag (`classify`).
  Inline elements are cut into; block containers are split inside themselves; everything else is
  one piece. An inline-level piece rides along inside its line and counts as one word; a
  block-level piece is left where it is and is no unit; a float is put back in front of the line it
  floated beside and is no unit; hidden content is left alone. A floated drop cap is a float.
- **The split only structures and marks.** Units carry `data-line`, `data-word`, `data-char` and
  the same index as `--line`, `--word`, `--char`; masks carry `data-mask`; the target carries
  `data-split` and the counts. No animation, no colours, no opinions in the library.
- **Dependency-free, ES2022, one file.** The README states the built size. Keep it honest: the
  release script restates it, and a change that grows the library by more than a few hundred bytes
  gzipped deserves a second look.

## How to change behaviour

1. Find or add the case in `demo/index.html` that shows the behaviour. Every behaviour has one.
   Follow `.agents/skills/demo-case`.
2. Change `src/index.ts`. Comments in this file explain why, in full sentences, in the voice of
   the existing ones. Match that voice.
3. Run `npm run check` and `npm test`. All three browsers must pass. When a case fails, or to
   see what the split actually produced, follow `.agents/skills/browser-probe`.
4. Update the README (the "What a unit is" section is the contract), and add a line under
   `## [Unreleased]` in `CHANGELOG.md` for anything a user of the library would notice.
5. The whole checklist is in `.agents/skills/library-change`.

## Conventions

- **Commits** follow Conventional Commits, enforced by a hook: `feat`, `fix`, `docs`, `ci`,
  `build`, `chore`, `refactor`, `test`; header at most 72 characters, lowercase scope, a blank line
  before the body. The body explains why, not what. No attribution lines, no tool names, no
  co-author trailers.
- **Do not commit or push unless asked**, and ask again for each commit or push.
- **Pull requests** follow `.github/PULL_REQUEST_TEMPLATE.md`: why, what changed, the case that shows
  it, and a ticked checklist. The Pull request workflow rejects a description that strays from it, a
  title or commit that is not Conventional Commits, and a failing check or suite, and main requires
  all four to pass before a merge.
- **Prose** (docs, comments, commit messages, demo copy) uses plain sentences. No em dashes or en
  dashes: use a period, a comma, a colon or parentheses instead. Hyphens in compound words are fine.
- **Formatting** is Biome's, run by the pre-commit hook on staged files. TypeScript is strict.
- **Node** is pinned in `.nvmrc`; `engine-strict` is on.

## Releasing

`npm run release -- patch|minor|major` runs the checks and the suite, rolls the changelog,
restates the size, bumps, commits, tags and pushes. The tag starts the Release workflow, which
publishes to npm through trusted publishing and lists the GitHub release; no npm login or
one-time password is involved. Try `--dry-run` first. Details and recovery steps in
`.agents/skills/release`.
