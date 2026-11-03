// Regression: Issue #2 — init without --trigger must preserve an existing
// global trigger and interval instead of silently resetting it to queued.
// Runs from the owning repository after building dist/. Uses only an isolated
// temporary home; never launches a repair runner.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = resolve(process.env.SKILLHONE_TEST_REPO || process.cwd());
const { main } = await import(pathToFileURL(join(repo, 'dist/cli.js')).href);
const root = mkdtempSync(join(tmpdir(), 'skillhone-init-policy-'));
const home = join(root, 'home');
const source = join(root, 'demo');
mkdirSync(source);
writeFileSync(join(source, 'SKILL.md'), '---\nname: init-policy-demo\ndescription: Public isolated policy test\n---\nDemo.\n');
const originalLog = console.log;
async function cli(args) {
  const output = [];
  console.log = (...parts) => output.push(parts.map(String).join(' '));
  try {
    assert.equal(await main(['--home', home, '--json', ...args]), 0);
    return JSON.parse(output.at(-1));
  } finally { console.log = originalLog; }
}
try {
  // Establish a non-default global trigger and interval.
  const initial = await cli(['config', 'set', '--trigger', 'scheduled', '--interval-minutes', '30', '--merge', 'automatic']);
  assert.equal(initial.trigger.mode, 'scheduled');
  assert.equal(initial.trigger.interval_minutes, 30);

  // Import another skill without --trigger: the saved global policy must survive.
  await cli(['--repo', source, 'init', '--mode', 'copy', '--merge', 'automatic']);
  const after = await cli(['config', 'show']);
  assert.equal(after.trigger.mode, 'scheduled', 'Importing another skill must preserve the saved global trigger when --trigger is omitted');
  assert.equal(after.trigger.interval_minutes, 30, 'Importing another skill must preserve the saved interval when --interval-minutes is omitted');
  assert.equal(after.merge.mode, 'automatic');

  // An explicit --trigger still wins.
  await cli(['--repo', source, 'init', '--mode', 'copy', '--merge', 'automatic', '--trigger', 'immediate']);
  const overridden = await cli(['config', 'show']);
  assert.equal(overridden.trigger.mode, 'immediate', 'An explicit --trigger must be honored');
} finally {
  console.log = originalLog;
  rmSync(root, { recursive: true, force: true });
}