import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Keep synthetic admission fixtures compatible with the public secret scan.
const directory = mkdtempSync(join(tmpdir(), 'skillhone-release-hygiene-'));
try {
  copyFileSync('.test/preflight-real-skill-shapes.mjs', join(directory, 'fixture.mjs'));
  const scan = spawnSync('gitleaks', ['dir', '--redact=100', '--no-banner', directory], { encoding: 'utf8' });
  assert.ifError(scan.error);
  assert.equal(scan.status, 0, 'The synthetic admission fixture must pass gitleaks.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
