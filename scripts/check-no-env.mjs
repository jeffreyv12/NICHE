#!/usr/bin/env node
// Pre-commit guard: refuses to let secret files reach a commit.
// Wired via lint-staged in package.json — receives staged file paths as argv.
// Non-negotiable #11 in CLAUDE.md: never commit secrets.

import { basename } from "node:path";

const ALLOWED = new Set([".env.example"]);

const FORBIDDEN_PATTERNS = [
  /^\.env$/,
  /^\.env\..+$/, // .env.local, .env.production, .env.test.local, etc.
];

const SECRET_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);

const offenders = [];

for (const path of process.argv.slice(2)) {
  const name = basename(path);

  if (ALLOWED.has(name)) continue;

  const matchesEnv = FORBIDDEN_PATTERNS.some((re) => re.test(name));
  const matchesSecretExt = [...SECRET_EXTENSIONS].some((ext) => name.endsWith(ext));

  if (matchesEnv || matchesSecretExt) {
    offenders.push(path);
  }
}

if (offenders.length > 0) {
  console.error("\n  Refusing to commit — these files look like secrets:\n");
  for (const path of offenders) console.error(`    - ${path}`);
  console.error("\n  If this is a false positive, edit scripts/check-no-env.mjs.");
  console.error("  Otherwise: git restore --staged <file> and put it in .env.local.\n");
  process.exit(1);
}
