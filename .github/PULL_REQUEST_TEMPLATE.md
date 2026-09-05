<!--
Every section below is required, and a workflow checks this description against this template on
every push and edit: the headings must stay as they are, each section must be written, and every
box in the checklist must be ticked. How the library is changed is in AGENTS.md and
.agents/skills/library-change.
-->

## Why

<!--
The problem, the situation running text can be in, or the reason. Not what the diff does.
-->

## What changed

<!--
The change in a few sentences, and anything a reviewer should look at first. For a change to
src/index.ts, say how the two phases stay apart and why nothing the split writes can move a wrap.
-->

## Case

<!--
The data-case in demo/index.html that shows the behaviour, added or existing, as `#case-id`. For a
change with no behaviour to show (docs, the release scripts, this template) write `none` and why.
-->

## Checklist

<!--
Tick every box. A line that does not apply is still ticked, with a word on why after it, for
example "README: the contract did not move".
-->

- [ ] `npm run check` and `npm test` pass, in Chromium, WebKit and Firefox
- [ ] The case above shows the behaviour, and its `case-expect` says what the reader sees
- [ ] The two phases stay apart: no layout read between DOM writes in `src/index.ts`
- [ ] README: the feature bullets, "What a unit is" and the caveats say what is now true
- [ ] CHANGELOG: a line under `## [Unreleased]` for anything a user of the library would notice
- [ ] Size: `npm run size` grew by no more than a few hundred gzipped bytes, or the growth is explained above
- [ ] Prose and comments are plain sentences in the file's voice, with no em dashes or en dashes
- [ ] Commits follow Conventional Commits, and so does the title of this pull request
