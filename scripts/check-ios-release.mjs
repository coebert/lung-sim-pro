#!/usr/bin/env node
// iOS release configuration checks.
//   --source   (preflight) validates capacitor.config.ts only. Ignores any stale
//              native config, so a reverted live-reload setup can be re-synced.
//   --release  (strict, post-sync) additionally REQUIRES
//              ios/App/App/capacitor.config.json and ios/App/App/public/index.html
//              and rejects remote/cleartext server settings in the native config.
//   --root DIR project root (default: cwd).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const mode = args.includes('--release') ? 'release' : 'source';
const rootIdx = args.indexOf('--root');
const root = resolve(rootIdx >= 0 ? args[rootIdx + 1] : process.cwd());

function serverProblems(cfg, label) {
  const out = [];
  if (!cfg || typeof cfg !== 'object') return [`${label}: config is not an object`];
  if (cfg.server !== undefined) {
    const s = cfg.server ?? {};
    if (s.url) out.push(`${label}: server.url is set (${s.url}) — release builds must load bundled assets`);
    if (s.cleartext) out.push(`${label}: server.cleartext is enabled`);
    if (s.hostname && !s.url) { /* hostname alone is local-only and allowed */ }
  }
  if (cfg.ios?.allowsLinkPreview === undefined) { /* no-op */ }
  return out;
}

const errors = [];

// Source config: evaluate the real exported object (Node >= 22.18 strips TS types).
const srcPath = resolve(root, 'capacitor.config.ts');
let source;
try {
  source = (await import(pathToFileURL(srcPath).href + `?t=${Date.now()}`)).default;
} catch (e) {
  errors.push(`capacitor.config.ts could not be loaded: ${e.message}`);
}
if (source) {
  errors.push(...serverProblems(source, 'capacitor.config.ts'));
  if (source.webDir !== 'dist') errors.push(`capacitor.config.ts: webDir must be 'dist' (got ${source.webDir})`);
}

if (mode === 'release') {
  const nativeCfg = resolve(root, 'ios/App/App/capacitor.config.json');
  const nativeIndex = resolve(root, 'ios/App/App/public/index.html');
  if (!existsSync(nativeCfg)) errors.push('ios/App/App/capacitor.config.json missing — run cap sync ios');
  else {
    try { errors.push(...serverProblems(JSON.parse(readFileSync(nativeCfg, 'utf8')), 'ios/App/App/capacitor.config.json')); }
    catch (e) { errors.push(`ios/App/App/capacitor.config.json unreadable: ${e.message}`); }
  }
  if (!existsSync(nativeIndex)) errors.push('ios/App/App/public/index.html missing — bundled web assets not synced');
}

if (errors.length) {
  console.error(`iOS ${mode} check FAILED:\n - ` + errors.join('\n - '));
  process.exit(1);
}
console.log(`iOS ${mode} check passed.`);
