#!/usr/bin/env node
// Reproducible iOS prepare: source preflight → production build → add/sync ios → strict release check.
// Every step's output is streamed and its exit code is propagated.
// IOS_PREPARE_BUILD_CMD overrides the build command (used by tests only).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const check = resolve(dirname(fileURLToPath(import.meta.url)), 'check-ios-release.mjs');

function run(label, cmd) {
  console.log(`\n▶ ${label}: ${cmd}`);
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true, cwd: root });
  const code = r.status ?? 1;
  if (code !== 0) { console.error(`✖ ${label} failed (exit ${code})`); process.exit(code); }
}

run('source preflight', `node "${check}" --source --root "${root}"`);
run('production build', process.env.IOS_PREPARE_BUILD_CMD || 'npx vite build');
if (!existsSync(resolve(root, 'dist/index.html'))) { console.error('✖ dist/index.html missing after build'); process.exit(1); }
if (!existsSync(resolve(root, 'ios'))) run('create iOS project', 'npx cap add ios');
run('sync iOS', 'npx cap sync ios');
run('strict release check', `node "${check}" --release --root "${root}"`);
console.log('\n✔ iOS prepare complete (signing/archive must be done in Xcode on macOS).');
