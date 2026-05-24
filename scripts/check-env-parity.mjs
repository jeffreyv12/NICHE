#!/usr/bin/env node
// Verifies .env.example and packages/shared/src/env.ts list the same variables.
// CI fails if either side is missing a key.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // repo root
const ENV_EXAMPLE = join(ROOT, '.env.example');
const ENV_TS = join(ROOT, 'packages', 'shared', 'src', 'env.ts');

const exampleText = readFileSync(ENV_EXAMPLE, 'utf8');
const tsText = readFileSync(ENV_TS, 'utf8');

const exampleKeys = new Set(
  exampleText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('=')[0])
    .filter(Boolean),
);

// Match `  KEY: ...` lines inside the envSchema. Quoted keys allowed but rare.
const tsKeyRe = /^\s+([A-Z][A-Z0-9_]*)\s*:/gm;
const tsKeys = new Set();
for (const m of tsText.matchAll(tsKeyRe)) {
  tsKeys.add(m[1]);
}

const onlyInExample = [...exampleKeys].filter((k) => !tsKeys.has(k)).sort();
const onlyInTs = [...tsKeys].filter((k) => !exampleKeys.has(k)).sort();

let failed = false;

if (onlyInExample.length > 0) {
  console.error('\nKeys in .env.example but missing from packages/shared/src/env.ts:');
  for (const k of onlyInExample) console.error(`  - ${k}`);
  failed = true;
}

if (onlyInTs.length > 0) {
  console.error('\nKeys in packages/shared/src/env.ts but missing from .env.example:');
  for (const k of onlyInTs) console.error(`  - ${k}`);
  failed = true;
}

if (failed) {
  console.error('\nEnv parity check failed. Update both files in the same PR.\n');
  process.exit(1);
}

console.log(`Env parity OK — ${tsKeys.size} keys aligned.`);
