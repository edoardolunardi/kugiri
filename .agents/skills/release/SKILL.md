---
name: release
description: Cut a release of kugiri with npm run release, which rolls the changelog, restates the size, bumps, tags, pushes, publishes to npm and opens a GitHub release. Use when asked to release, publish, tag or version the library, and to recover when a release stopped halfway.
---

# Release

One command does the whole release, from a clean `main`:

```sh
npm run release -- patch      # 0.2.0 -> 0.2.1
npm run release -- minor      # 0.2.0 -> 0.3.0
npm run release -- major      # 0.2.0 -> 1.0.0
npm run release -- 0.4.2      # an explicit version
```

Add `--dry-run` to see everything it would do without writing a file or touching git, npm or
GitHub. Add `--skip-tests` only when the suite has just passed on this exact commit.

A push to `main` does not release anything: the only workflow in the repository publishes the demo
to GitHub Pages. Releases are cut from a machine with this script.

## What it does, in order

1. **Preflight.** On `main`, clean tree, not behind `origin/main`, tag not taken, logged in to npm
   (`npm whoami`), `gh auth status` checked (a missing `gh` only skips the last step).
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
8. **Publish.** `npm publish`; `prepack` builds `dist/` again.
9. **GitHub release.** `gh release create vx.y.z` with the changelog section as the notes.

## Which bump

- **patch**: fixes only, nothing a caller would notice beyond the fix.
- **minor**: anything that changes what the split produces or adds to the API. Under 0.x this is
  also where a change of contract goes (which elements are units, what a line holds).
- **major**: once 1.0 is out, a change of contract.

Before running it, read the Unreleased section as a user of the library would and decide the
bump from what is there, not from the size of the diff.

## Prerequisites, once per machine

```sh
npm login          # publish rights on the kugiri package
gh auth login      # optional, for the GitHub release
```

## When it stops halfway

Every step prints `==> step` before it runs, so the last heading says where it stopped.

- **Before "write"**: nothing was changed. Fix the cause (a failing check, an empty changelog, a
  dirty tree) and run it again.
- **At "commit and tag" or "push"**: the files are written and possibly committed. `git status`
  and `git log -1` show how far it got; finish by hand with the commands in the list above, or
  `git reset --hard origin/main` and `git tag -d vx.y.z` to start over.
- **At "publish"**: the commit and the tag are pushed. Fix the npm problem and run
  `npm publish` by hand. Do not bump again; the version is already committed.
- **At "github release"**: everything shipped. Run the `gh release create` command it printed.

Never delete or move a tag that has been pushed and published: cut the next version instead.
