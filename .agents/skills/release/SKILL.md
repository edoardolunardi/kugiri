---
name: release
description: Cut a release of kugiri with npm run release, which rolls the changelog, restates the size, bumps, tags and pushes; the Release workflow then publishes to npm through trusted publishing and lists the GitHub release. Use when asked to release, publish, tag or version the library, and to recover when a release stopped halfway.
---

# Release

One command from a clean `main`:

```sh
npm run release -- patch      # 0.2.0 -> 0.2.1
npm run release -- minor      # 0.2.0 -> 0.3.0
npm run release -- major      # 0.2.0 -> 1.0.0
npm run release -- 0.4.2      # an explicit version
```

Add `--dry-run` to see everything it would do without writing a file or touching git. Add
`--skip-tests` only when the suite has just passed on this exact commit.

No npm login and no one-time password are involved. The script ends by pushing the tag, and the
tag starts `.github/workflows/release.yml`, which publishes to npm through trusted publishing
(OIDC, with provenance) and creates the GitHub release with the changelog section as notes. A
push to `main` without a tag releases nothing; it only rebuilds the demo on GitHub Pages.

## What happens, in order

The script:

1. **Preflight.** On `main`, clean tree, not behind `origin/main`, tag not taken.
2. **Changelog.** Reads `## [Unreleased]` in `CHANGELOG.md`. Empty means there is nothing to
   release, and it stops.
3. **Checks.** `npm run check`, `npm test`, `npm run build`.
4. **Size.** Minifies the build, gzips and brotlis it, and restates the figures in the README and
   the demo header.
5. **Write.** Turns the Unreleased entries into `## [x.y.z] - YYYY-MM-DD`, leaves an empty
   Unreleased above it, and runs `npm version x.y.z --no-git-tag-version`.
6. **Commit and tag.** `chore(release): x.y.z` and an annotated `vx.y.z`. The commit passes the
   commitlint hook.
7. **Push.** `git push --follow-tags origin main`.

The workflow, on the tag:

8. Checks out the tag, verifies it names the version in `package.json`, runs `npm run check`.
9. `npm publish --provenance --access public`. `prepack` builds `dist/`.
10. `gh release create vx.y.z` with the output of `scripts/notes.mjs` as the notes, unless the
    release already exists.

Watch it with `gh run watch`, or on the Actions tab.

## Which bump

- **patch**: fixes only, nothing a caller would notice beyond the fix.
- **minor**: anything that changes what the split produces or adds to the API. Under 0.x this is
  also where a change of contract goes (which elements are units, what a line holds).
- **major**: once 1.0 is out, a change of contract.

Read the Unreleased section as a user of the library would and decide the bump from what is
there, not from the size of the diff.

## One-time setup

On npmjs.com, package `kugiri`, Settings, Trusted publisher: GitHub Actions, owner
`edoardolunardi`, repository `kugiri`, workflow filename `release.yml`, environment left blank.
Without it the workflow's publish step fails with an authentication error and nothing else is
affected; set it up and run the workflow again for the same tag:

```sh
gh workflow run release.yml -f tag=v0.2.0
```

## When it stops halfway

The script prints `==> step` before each step, so the last heading says where it stopped.

- **Before "write"**: nothing was changed. Fix the cause (a failing check, an empty changelog, a
  dirty tree) and run it again.
- **At "commit and tag" or "push"**: the files are written and possibly committed. `git status`
  and `git log -1` show how far it got; finish by hand with the commands above, or
  `git reset --hard origin/main` and `git tag -d vx.y.z` to start over.
- **In the workflow**: the commit and the tag are pushed. Read the failed step's log, fix the
  cause (usually the trusted publisher setup), and run the workflow again for the same tag. Do
  not bump again; the version is already committed.

Never delete or move a tag that has been pushed: cut the next version instead.
