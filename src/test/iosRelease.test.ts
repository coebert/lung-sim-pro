// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(__dirname, '../..');
const CHECK = join(repo, 'scripts/check-ios-release.mjs');
const PREPARE = join(repo, 'scripts/ios-prepare.mjs');
const FAKE_BUILD = `node -e "require('fs').mkdirSync('dist',{recursive:true});require('fs').writeFileSync('dist/index.html','<html>bundled</html>')"`;

const BUNDLED_CFG = `const config = { appId: 'app.lovable.a148f60eaf3c442b9a0271a7e258d43a', appName: 'Lung Sim Pro', webDir: 'dist' };\nexport default config;\n`;
const REMOTE_CFG = `const config = { appId: 'x.y', appName: 'Lung Sim Pro', webDir: 'dist', server: { url: 'https://example.lovableproject.com', cleartext: true } };\nexport default config;\n`;

let dir: string;
const sh = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
const check = (mode: '--source' | '--release') => sh('node', [CHECK, mode, '--root', dir]);
const prepare = () => sh('node', [PREPARE], { IOS_PREPARE_BUILD_CMD: FAKE_BUILD });
const nativeCfg = () => join(dir, 'ios/App/App/capacitor.config.json');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ios-rel-'));
  copyFileSync(join(repo, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, 'capacitor.config.ts'), BUNDLED_CFG);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('iOS release workflow', () => {
  it('the real project config passes the source check', () => {
    const r = spawnSync('node', [CHECK, '--source', '--root', repo], { encoding: 'utf8' });
    expect(r.status).toBe(0);
  });

  it('fresh prepare creates the iOS project and passes the strict check', () => {
    const r = prepare();
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(existsSync(join(dir, 'ios/App/App/public/index.html'))).toBe(true);
    expect(JSON.parse(readFileSync(nativeCfg(), 'utf8')).server).toBeUndefined();
  }, 60_000);

  it('stale native remote config is repaired by sync after the source is reverted', () => {
    expect(prepare().status).toBe(0);
    const stale = JSON.parse(readFileSync(nativeCfg(), 'utf8'));
    stale.server = { url: 'https://example.lovableproject.com', cleartext: true };
    writeFileSync(nativeCfg(), JSON.stringify(stale));
    expect(check('--release').status).toBe(1); // stale native is rejected by strict check
    expect(check('--source').status).toBe(0);  // but does not block the preflight
    const r = prepare();
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(JSON.parse(readFileSync(nativeCfg(), 'utf8')).server).toBeUndefined();
  }, 60_000);

  it('strict check rejects an app icon with alpha or wrong size', () => {
    expect(prepare().status).toBe(0);
    const set = join(dir, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
    const icon = join(set, JSON.parse(readFileSync(join(set, 'Contents.json'), 'utf8')).images[0].filename);
    copyFileSync(join(repo, 'resources/app-icon-1024.png'), icon);
    expect(check('--release').status).toBe(0);
    const buf = readFileSync(icon);
    buf[25] = 6; // mark as RGBA
    writeFileSync(icon, buf);
    expect(check('--release').stderr).toMatch(/alpha channel/);
    buf[25] = 2; buf.writeUInt32BE(512, 16);
    writeFileSync(icon, buf);
    expect(check('--release').stderr).toMatch(/is 512x1024, expected 1024x1024/);
  }, 60_000);

  it('project icon master and native icon are 1024x1024 opaque and identical', async () => {
    const { pngProblems } = await import(join(repo, 'scripts/check-ios-release.mjs') + '?lib') as { pngProblems: (b: Buffer, l: string) => string[] };
    const master = readFileSync(join(repo, 'resources/app-icon-1024.png'));
    const native = readFileSync(join(repo, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'));
    expect(pngProblems(master, 'master')).toEqual([]);
    expect(native.equals(master)).toBe(true);
  });

  it('strict check rejects missing native config', () => {
    mkdirSync(join(dir, 'ios/App/App/public'), { recursive: true });
    writeFileSync(join(dir, 'ios/App/App/public/index.html'), 'x');
    const r = check('--release');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/capacitor\.config\.json missing/);
  });

  it('strict check rejects missing bundled web assets', () => {
    mkdirSync(join(dir, 'ios/App/App'), { recursive: true });
    writeFileSync(nativeCfg(), JSON.stringify({ appId: 'x', webDir: 'dist' }));
    const r = check('--release');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/public\/index\.html missing/);
  });

  it('active source remote config is rejected before building', () => {
    writeFileSync(join(dir, 'capacitor.config.ts'), REMOTE_CFG);
    const r = prepare();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\.url is set/);
    expect(r.stderr).toMatch(/cleartext/);
    expect(existsSync(join(dir, 'dist'))).toBe(false);
  });

  it('a URL inside a string does not confuse the source check', () => {
    writeFileSync(join(dir, 'capacitor.config.ts'),
      `const config = { appId: 'a.b', appName: 'Lung Sim Pro // https://x', webDir: 'dist' };\nexport default config;\n`);
    expect(check('--source').status).toBe(0);
  });
});
