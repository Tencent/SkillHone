// Regression test: preflight scanner must not reject env-var references,
// function calls, placeholder tokens, or documentation text that contains
// the words "token" / "authorization" / "api_key" without an assigned literal value.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(process.env.SKILLHONE_TEST_REPO || process.cwd());
const { main } = await import(pathToFileURL(join(repo, 'dist/cli.js')).href);

const root = mkdtempSync(join(tmpdir(), 'sh-preflight-fp-'));
const home = join(root, 'home');
mkdirSync(home);

const originalLog = console.log;
async function cli(args) {
  const output = [];
  console.log = (...parts) => output.push(parts.map(String).join(' '));
  try {
    const code = await main(['--home', home, '--json', ...args]);
    return { code, out: JSON.parse(output.at(-1) ?? 'null') };
  } catch (e) { return { code: 1, err: e.message }; }
  finally { console.log = originalLog; }
}

async function makeSkill(dir, name, files) {
  const d = join(root, dir);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: Preflight FP test fixture\n---\nDemo.\n`);
  for (const [rel, body] of Object.entries(files)) {
    const fp = join(d, rel);
    mkdirSync(dirname(fp), { recursive: true });
    writeFileSync(fp, body);
  }
  return d;
}

try {
  // Fixture 1: token read from environment variable only (should pass)
  const s1 = await makeSkill('sk-env', 'sk-env-read', {
    'scripts/connect_mcp.py': `import os\ntoken = os.environ.get('MY_TOKEN')\napi_key = os.environ['MY_API_KEY']\n`,
  });
  const r1 = await cli(['--repo', s1, 'init', '--mode', 'copy', '--merge', 'automatic']);
  assert.equal(r1.code, 0, `Env-var-only token rejected: ${JSON.stringify(r1)}`);

  // Fixture 2: documentation mentions placeholder patterns (should pass)
  const s2 = await makeSkill('sk-doc', 'sk-doc-placeholder', {
    'SKILL.md': `---\nname: sk-doc-placeholder\ndescription: Docs test\n---\nSet token via: export MY_TOKEN=your_token_here\nAuthorization: Bearer example_pat_xxx\n`,
  });
  const r2 = await cli(['--repo', s2, 'init', '--mode', 'copy', '--merge', 'automatic']);
  assert.equal(r2.code, 0, `Placeholder doc rejected: ${JSON.stringify(r2)}`);

  // Fixture 3: authorization header using variable, not literal (should pass)
  const s3 = await makeSkill('sk-var', 'sk-var-auth', {
    'scripts/call.py': `import os\nheaders = {"Authorization": f"Bearer {os.environ['TOKEN']}"}\n`,
  });
  const r3 = await cli(['--repo', s3, 'init', '--mode', 'copy', '--merge', 'automatic']);
  assert.equal(r3.code, 0, `f-string var auth rejected: ${JSON.stringify(r3)}`);

  // Fixture 4: a file that contains the word "token" in a comment (should pass)
  const s4 = await makeSkill('sk-comment', 'sk-comment-token', {
    'scripts/setup.js': `// Read token from environment: process.env.MY_TOKEN\nconst token = process.env.MY_TOKEN;\n`,
  });
  const r4 = await cli(['--repo', s4, 'init', '--mode', 'copy', '--merge', 'automatic']);
  assert.equal(r4.code, 0, `process.env token rejected: ${JSON.stringify(r4)}`);

  // Fixture 4b: shapes seen in real blocked skills (function calls, angle placeholders, prose)
  const s4b = await makeSkill('sk-shapes', 'sk-shapes', {
    'auth.py': `import getpass\npassword = getpass.getpass('pw: ')\ntoken = load_token()\n`,
    'docs.md': `Header: Authorization: <api_key_from_console>\nkubectl --token=<kubeconfig-token>\nEXAMPLE_API_KEY=example_ak_*\u3002401\n`,
  });
  const r4b = await cli(['--repo', s4b, 'init', '--mode', 'copy', '--merge', 'automatic']);
  assert.equal(r4b.code, 0, `Real-world non-secret shapes rejected: ${JSON.stringify(r4b)}`);

  // Fixture 5: a synthetic secret-shaped literal MUST still be rejected.
  const syntheticToken = 'sk-' + 'a'.repeat(32);
  const s5 = await makeSkill('sk-synthetic', 'sk-synthetic-secret', {
    'SKILL.md': `---\nname: sk-synthetic-secret\ndescription: Synthetic fixture that should be blocked\n---\napi_key = "${syntheticToken}"\n`,
  });
  const r5 = await cli(['--repo', s5, 'init', '--mode', 'copy', '--merge', 'automatic']);
  assert.notEqual(r5.code, 0, `Synthetic secret-shaped literal was NOT rejected – scanner broken: ${JSON.stringify(r5)}`);

  console.log('All preflight false-positive regression tests passed.');
} finally {
  console.log = originalLog;
  rmSync(root, { recursive: true, force: true });
}
