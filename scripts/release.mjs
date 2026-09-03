// Cuts a release in one go: checks the tree, runs the checks and the suite, rolls the changelog's
// Unreleased section into a dated version section, restates the library size in the README and the
// demo, bumps the version, commits, tags, pushes, publishes to npm and opens a GitHub release.
//
//   npm run release -- patch|minor|major|<x.y.z> [--dry-run] [--skip-tests]
//
// A dry run does every read and every check and prints what it would write, without touching a
// file, git, npm or GitHub. Nothing here is part of the library.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { kb, sizes } from "./size.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipTests = args.includes("--skip-tests");
const bump = args.find((arg) => !arg.startsWith("--"));

const fail = (message) => {
  console.error(`\nrelease: ${message}`);
  process.exit(1);
};

const step = (title) => console.log(`\n==> ${title}`);

/** Runs a command for its output. */
const read = (command, options = {}) =>
  execFileSync(command[0], command.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();

/** Runs a command for its effect, streaming its output, and stops the release if it fails. */
const run = (command, options = {}) => {
  console.log(`$ ${command.join(" ")}`);

  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit", ...options });

  if (result.status !== 0) {
    fail(`"${command.join(" ")}" failed`);
  }
};

const quietly = (command) => {
  try {
    return read(command);
  } catch {
    return null;
  }
};

// The version asked for.

if (!bump) {
  fail("usage: npm run release -- patch|minor|major|<x.y.z> [--dry-run] [--skip-tests]");
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const current = pkg.version;
const parts = current.split(".").map(Number);
const next =
  bump === "major"
    ? `${parts[0] + 1}.0.0`
    : bump === "minor"
      ? `${parts[0]}.${parts[1] + 1}.0`
      : bump === "patch"
        ? `${parts[0]}.${parts[1]}.${parts[2] + 1}`
        : bump;

if (!/^\d+\.\d+\.\d+$/.test(next)) {
  fail(`"${bump}" is neither patch, minor, major nor a version like 1.2.3`);
}

const tag = `v${next}`;
const today = new Date().toISOString().slice(0, 10);

// The tree: on main, clean, not behind the remote, tag free, logged in to npm.

step(`preflight for ${current} -> ${next}${dryRun ? " (dry run)" : ""}`);

/** A condition the real run stops on; a dry run only reports it, so it can be tried mid-work. */
const ensure = (ok, message) => {
  if (ok) {
    return;
  }

  if (dryRun) {
    console.log(`would stop: ${message}`);
  } else {
    fail(message);
  }
};

ensure(read(["git", "rev-parse", "--abbrev-ref", "HEAD"]) === "main", "releases are cut from main");
ensure(!read(["git", "status", "--porcelain"]), "the working tree is not clean; commit or stash first");

run(["git", "fetch", "--quiet", "origin", "main"]);

const upToDate = spawnSync("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"]).status === 0;

ensure(upToDate, "main is behind origin/main; pull first");

if (quietly(["git", "rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]) !== null) {
  fail(`tag ${tag} already exists`);
}

const npmUser = quietly(["npm", "whoami"]);

if (!npmUser) {
  fail("not logged in to npm; run `npm login` first");
}

const hasGh = spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status === 0;

console.log(
  `on main at ${read(["git", "rev-parse", "--short", "HEAD"])}, npm user ${npmUser}, gh ${hasGh ? "ready" : "not available"}`
);

// The changelog: what Unreleased holds becomes the new version's section.

step("changelog");

const changelogPath = "CHANGELOG.md";
const changelog = readFileSync(changelogPath, "utf8");
const unreleased = changelog.match(/^## \[Unreleased\]\n([\s\S]*?)(?=^## \[)/m);

if (!unreleased) {
  fail("CHANGELOG.md has no `## [Unreleased]` section followed by a version section");
}

const notes = unreleased[1].trim();

if (!notes) {
  fail("the Unreleased section is empty; nothing to release");
}

console.log(notes);

// The checks and the suite, on the code about to ship.

step("checks");
run(["npm", "run", "check"]);

if (skipTests) {
  console.log("tests skipped");
} else {
  run(["npm", "test"]);
}

run(["npm", "run", "build"]);

// The size, restated where the docs state it.

step("size");

const bytes = sizes();
const size = { minified: kb(bytes.minified), gzipped: kb(bytes.gzipped), brotli: kb(bytes.brotli) };

console.log(`${size.gzipped} gzipped, ${size.minified} minified, ${size.brotli} brotli`);

const readmePath = "README.md";
const readme = readFileSync(readmePath, "utf8");
const readmeSized = readme.replace(
  /About [\d.]+ kB minified and gzipped \([\d.]+ kB(\s+)minified, [\d.]+ kB with brotli\)/,
  (_, gap) => `About ${size.gzipped} minified and gzipped (${size.minified}${gap}minified, ${size.brotli} with brotli)`
);

const demoPath = "demo/index.html";
const demo = readFileSync(demoPath, "utf8");
const demoSized = demo.replace(/about [\d.]+ kB minified and gzipped/, `about ${size.gzipped} minified and gzipped`);

if (readmeSized === readme && !readme.includes(`About ${size.gzipped} minified and gzipped`)) {
  fail("could not find the size sentence in README.md");
}

if (demoSized === demo && !demo.includes(`about ${size.gzipped} minified and gzipped`)) {
  fail("could not find the size sentence in demo/index.html");
}

// The writes, then git, npm and GitHub.

const section = `## [Unreleased]\n\n## [${next}] - ${today}\n\n${notes}\n\n`;
const rolled = changelog.replace(/^## \[Unreleased\]\n[\s\S]*?(?=^## \[)/m, section);

if (dryRun) {
  step("dry run: would write");
  console.log(`CHANGELOG.md: new section "## [${next}] - ${today}" with the ${notes.split("\n").length} lines above`);
  console.log(
    `README.md and demo/index.html: ${readmeSized === readme && demoSized === demo ? "sizes unchanged" : "sizes updated"}`
  );
  console.log(`package.json, package-lock.json: version ${next}`);
  console.log(`git: commit "chore(release): ${next}", tag ${tag}, push to origin main with tags`);
  console.log(`npm: publish ${pkg.name}@${next}`);
  console.log(
    `github: release ${tag} with the changelog section as notes${hasGh ? "" : " (gh not available, would print the command)"}`
  );
  process.exit(0);
}

step("write");
writeFileSync(changelogPath, rolled);
writeFileSync(readmePath, readmeSized);
writeFileSync(demoPath, demoSized);
run(["npm", "version", next, "--no-git-tag-version"]);

step("commit and tag");
run(["git", "add", changelogPath, readmePath, demoPath, "package.json", "package-lock.json"]);
run(["git", "commit", "--quiet", "-m", `chore(release): ${next}`]);
run(["git", "tag", "-a", tag, "-m", `${pkg.name} ${next}`]);

step("push");
run(["git", "push", "--follow-tags", "origin", "main"]);

step("publish");
run(["npm", "publish"]);

step("github release");

const notesPath = join(tmpdir(), `${pkg.name}-${next}-notes.md`);

writeFileSync(notesPath, `${notes}\n`);

if (hasGh) {
  run(["gh", "release", "create", tag, "--title", tag, "--notes-file", notesPath]);
} else {
  console.log(
    `gh is not available; create the release by hand:\n  gh release create ${tag} --title ${tag} --notes-file ${notesPath}`
  );
}

step(`released ${pkg.name}@${next}`);
