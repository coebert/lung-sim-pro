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
  }
  return out;
}

/** AppIcon set: every Contents.json entry must point to an existing 1024×1024 PNG with no alpha. */
function checkAppIcon(dir) {
  const label = 'AppIcon.appiconset';
  const contents = resolve(dir, 'Contents.json');
  if (!existsSync(contents)) return [`${label}/Contents.json missing`];
  const images = JSON.parse(readFileSync(contents, 'utf8')).images ?? [];
  if (!images.length) return [`${label} has no images`];
  const out = [];
  for (const img of images) {
    if (!img.filename) { out.push(`${label}: entry ${img.size} has no file`); continue; }
    const f = resolve(dir, img.filename);
    if (!existsSync(f)) { out.push(`${label}/${img.filename} missing`); continue; }
    out.push(...pngProblems(readFileSync(f), `${label}/${img.filename}`, img.size));
  }
  return out;
}

export function pngProblems(buf, label, expectedSize = '1024x1024') {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return [`${label} is not a PNG`];
  const out = [];
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), colorType = buf[25];
  if (`${w}x${h}` !== expectedSize) out.push(`${label} is ${w}x${h}, expected ${expectedSize}`);
  if (colorType === 4 || colorType === 6) out.push(`${label} has an alpha channel (App Store icons must be opaque)`);
  // tRNS chunk = transparency on palette/RGB images
  let o = 8;
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'tRNS') { out.push(`${label} has a transparency (tRNS) chunk`); break; }
    if (type === 'IDAT' || type === 'IEND') break;
    o += 12 + len;
  }
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
  errors.push(...checkAppIcon(resolve(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset')));
}

if (errors.length) {
  console.error(`iOS ${mode} check FAILED:\n - ` + errors.join('\n - '));
  process.exit(1);
}
console.log(`iOS ${mode} check passed.`);
