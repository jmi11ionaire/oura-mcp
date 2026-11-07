#!/usr/bin/env node
// Checks that a deployed app's /health reports the commit that was just shipped.
// Usage: node scripts/verify-health.mjs https://oura-mcp-jesse.fly.dev
// The expected commit is EXPECTED_COMMIT, or this checkout's HEAD.
import { execFileSync } from 'node:child_process';

const base = process.argv[2];
if (!base) {
  console.error('usage: node scripts/verify-health.mjs <base-url>');
  process.exit(2);
}
const expected =
  process.env.EXPECTED_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const url = new URL('/health', base).toString();

let last = 'no response';
for (let attempt = 1; attempt <= 10; attempt++) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok === true && body.version === expected) {
      console.log(`${url} reports ${expected}`);
      process.exit(0);
    }
    last = `HTTP ${res.status}, version ${body.version ?? 'missing'}`;
  } catch (err) {
    last = err instanceof Error ? err.message : String(err);
  }
  await new Promise((resolve) => setTimeout(resolve, 3_000));
}
console.error(`${url} does not report ${expected} (${last})`);
process.exit(1);
