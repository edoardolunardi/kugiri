// The built library's size, the way the README states it: minified, then gzipped and brotli'd at
// the highest level. `npm run size` prints it; the release script restates it in the docs.
// Nothing here is part of the library.

import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

/** Bytes of dist/index.js minified, gzipped and brotli'd. Needs a build. */
export function sizes() {
  const minified = execFileSync("npx", ["--yes", "esbuild", "dist/index.js", "--minify", "--format=esm", "--log-level=silent"]);

  return {
    minified: minified.length,
    gzipped: gzipSync(minified, { level: 9 }).length,
    brotli: brotliCompressSync(minified, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
}

/** Bytes as the docs state them: one decimal, thousands. */
export const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const size = sizes();

  console.log(
    `${kb(size.gzipped)} gzipped, ${kb(size.minified)} minified, ${kb(size.brotli)} brotli (${size.gzipped}, ${size.minified}, ${size.brotli} bytes)`
  );
}
