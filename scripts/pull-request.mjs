// Checks a pull request description against .github/PULL_REQUEST_TEMPLATE.md: every heading of
// the template is present and in order, every section is written, no placeholder is left, and
// every box of the checklist is ticked. The Pull request workflow runs it on the description at
// every push and edit; run it by hand on a file, or on stdin with `-`:
//
//   node scripts/pull-request.mjs body.md
//   gh pr view 12 --json body -q .body | node scripts/pull-request.mjs -
//
// Nothing here is part of the library.

import { readFileSync } from "node:fs";
import process from "node:process";

const source = process.argv[2];

if (!source) {
  console.error("usage: node scripts/pull-request.mjs <file | ->");
  process.exit(1);
}

const template = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8");
const body = source === "-" ? await stdin() : readFileSync(source, "utf8");

/** A synchronous read of a pipe fails with EAGAIN when the writer is slower than the reader. */
async function stdin() {
  let text = "";

  process.stdin.setEncoding("utf8");

  for await (const chunk of process.stdin) {
    text += chunk;
  }

  return text;
}

/** The headings and the checkboxes are the template's; comments and blank lines are not. */
function sections(markdown) {
  const stripped = markdown.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n");
  const result = new Map();
  let heading = "";

  for (const line of stripped.split("\n")) {
    const match = line.match(/^##\s+(.+?)\s*$/);

    if (match) {
      heading = match[1];
      result.set(heading, []);
    } else if (heading && line.trim()) {
      result.get(heading).push(line.trim());
    }
  }

  return result;
}

const expected = sections(template);
const actual = sections(body);
const failures = [];

const wanted = Array.from(expected.keys());
const found = Array.from(actual.keys()).filter((heading) => expected.has(heading));

for (const heading of wanted) {
  if (!actual.has(heading)) {
    failures.push(`the section "## ${heading}" is missing`);
  }
}

if (found.length === wanted.length && found.some((heading, index) => heading !== wanted[index])) {
  failures.push(`the sections are out of order: expected ${wanted.map((h) => `"${h}"`).join(", ")}`);
}

const placeholder = /\b(TODO|TBD|WIP|FIXME)\b|_TODO_/i;

for (const [heading, lines] of actual) {
  if (!expected.has(heading)) {
    continue;
  }

  const boxes = lines.filter((line) => /^[-*]\s+\[[ xX]\]/.test(line));
  const prose = lines.filter((line) => !/^[-*]\s+\[[ xX]\]/.test(line));

  if (boxes.length === 0 && prose.length === 0) {
    failures.push(`the section "## ${heading}" is empty`);
    continue;
  }

  if (lines.some((line) => placeholder.test(line))) {
    failures.push(`the section "## ${heading}" still holds a placeholder`);
  }

  const expectedBoxes = expected.get(heading).filter((line) => /^[-*]\s+\[[ xX]\]/.test(line));

  if (expectedBoxes.length > 0) {
    const unticked = boxes.filter((line) => /^[-*]\s+\[ \]/.test(line));

    if (boxes.length < expectedBoxes.length) {
      failures.push(`the section "## ${heading}" lists ${boxes.length} of the template's ${expectedBoxes.length} items`);
    }

    for (const line of unticked) {
      failures.push(`unticked: ${line.replace(/^[-*]\s+\[ \]\s*/, "")}`);
    }
  }
}

if (failures.length > 0) {
  console.error("The description does not follow .github/PULL_REQUEST_TEMPLATE.md:");

  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }

  process.exit(1);
}

console.log("The description follows the template.");
