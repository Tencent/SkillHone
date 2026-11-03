import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Catalog } from '../dist/core/catalog.js';

const sandbox = mkdtempSync(join(tmpdir(), 'skillhone-admission-'));
let n = 0;
function fixture(body) {
  const root = join(sandbox, `source-${++n}`); mkdirSync(root);
  writeFileSync(join(root, 'SKILL.md'), '---\nname: sample\ndescription: Example.\n---\n');
  writeFileSync(join(root, 'example.txt'), body);
  return root;
}
const positive = [
  'Token: configure the token through your local credential manager.\n',
  'const token = process.env.SERVICE_TOKEN;\n',
  'token = os.environ.get("SERVICE_TOKEN")\n',
  'token = credentials.get_service_token()\n',
  'export API_KEY="${SERVICE_KEY:-${FALLBACK_KEY}}"\n',
  'const secret = client.readCredential("service")\n',
  'api_key: Use the existing Keychain entry for this provider.\n',
];
try {
  for (const body of positive) {
    const c = new Catalog(join(sandbox, `home-${n}`));
    try { c.importPath(fixture(body)); } finally { c.close(); }
  }
  for (const body of [
    'const token = "literal0123456789credential";\n',
    'token: literal0123456789credential\n',
    'export API_KEY="${SERVICE_KEY:-literal0123456789credential}"\n',
    '-----BEGIN PRIVATE KEY-----\n',
    'sk-' + 'a'.repeat(32),
  ]) {
    const c = new Catalog(join(sandbox, `negative-${n}`));
    try { assert.throws(() => c.importPath(fixture(body)), /credential/); }
    finally { c.close(); }
  }
  const home = join(sandbox, 'reuse-home'); const c = new Catalog(home);
  try {
    const imported = c.importPath(fixture('public example\n'));
    writeFileSync(join(imported.root, 'CHANGELOG.md'), 'Verified repair.\n');
    for (const args of [['add','.'],['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','Verified repair']]) {
      const p = spawnSync('git',args,{cwd:imported.root}); assert.equal(p.status,0);
    }
    const next = join(sandbox,'second-runtime');
    cpSync(imported.root,next,{recursive:true,filter:p=>!p.split('/').includes('.git')});
    const reused = c.importPath(next); assert.equal(reused.id, imported.id);
    assert.equal(c.syncStatus('sample').find(x=>x.path===next)?.state,'in_sync');
  } finally { c.close(); }
  console.log('PASS: safe expression admission, literal-secret rejection, current-repository origin reuse');
} finally { rmSync(sandbox,{recursive:true,force:true}); }
