// Prints one version's section of CHANGELOG.md, the notes of its GitHub release.
//
//   node scripts/notes.mjs 0.2.0
//
// Nothing here is part of the library.

import { readFileSync } from "node:fs";
import process from "node:process";

const version = process.argv[2];

if (!version) {
  console.error("usage: node scripts/notes.mjs <version>");
  process.exit(1);
}

const changelog = readFileSync("CHANGELOG.md", "utf8");
const escaped = version.replace(/\./g, "\\.");
const section = changelog.match(new RegExp(`^## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|(?![\\s\\S]))`, "m"));

if (!section?.[1].trim()) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}

console.log(section[1].trim());
