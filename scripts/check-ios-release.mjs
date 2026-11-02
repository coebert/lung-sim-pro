#!/usr/bin/env node
// Validates that the iOS release build loads bundled assets only.
// Fails on any remote server URL or cleartext setting in capacitor.config.ts
// or in the synced native config (ios/App/App/capacitor.config.json).
import { existsSync, readFileSync } from 'node:fs';

const errors = [];
const src = readFileSync('capacitor.config.ts', 'utf8').replace(/\/\/.*$/gm, '');
if (/\bserver\s*:/.test(src)) errors.push('capacitor.config.ts contains a `server` block');
if (/\bcleartext\b/.test(src)) errors.push('capacitor.config.ts enables cleartext');
if (/https?:\/\//.test(src)) errors.push('capacitor.config.ts references a remote URL');
if (!/webDir:\s*['"]dist['"]/.test(src)) errors.push("webDir must be 'dist'");

const requireDist = process.argv.includes('--require-dist');
if (requireDist && !existsSync('dist/index.html')) errors.push('dist/index.html missing — run the production build');

const nativeCfg = 'ios/App/App/capacitor.config.json';
if (existsSync(nativeCfg)) {
  const j = JSON.parse(readFileSync(nativeCfg, 'utf8'));
  if (j.server?.url) errors.push(`${nativeCfg} has server.url=${j.server.url}`);
  if (j.server?.cleartext) errors.push(`${nativeCfg} enables cleartext`);
}

if (errors.length) {
  console.error('iOS release check FAILED:\n - ' + errors.join('\n - '));
  process.exit(1);
}
console.log('iOS release check passed: bundled assets only, no remote/cleartext server.');
