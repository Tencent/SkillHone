#!/usr/bin/env node
/**
 * Public-only, isolated Catalog import regression draft.
 * Usage: node additional-public-import-forms.mjs /path/to/dist/core/catalog.js
 * Uses only a temporary home; never opens the user's live Catalog or skills.
 * No original source excerpts, endpoints, account names, paths or detected values
 * are embedded here. Synthetic opaque strings below are rejection test data.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleArgument = process.argv[2] ?? new URL("../dist/core/catalog.js", import.meta.url).pathname;
if (!moduleArgument) {
  process.stderr.write('Usage: node additional-public-import-forms.mjs /path/to/dist/core/catalog.js\n');
  process.exit(2);
}
const { Catalog } = await import(pathToFileURL(resolve(moduleArgument)).href);
const temporaryRoot = mkdtempSync(join(tmpdir(), 'public-import-forms-'));
const home = join(temporaryRoot, 'home');
const sourceRoot = join(temporaryRoot, 'sources');
mkdirSync(sourceRoot, { recursive: true });
const catalog = new Catalog(home);
const fixture = (name, allowed, file, body) => ({ name, allowed, file, body });
const opaqueLiteral = 'q7W2m9R4v8L6c3X5n1P0'; // Synthetic, never a usable credential.
const knownSignature = 'sk-' + 'A'.repeat(30); // Synthetic signature detector negative.
const cases = [
  fixture('natural-language-auth-note', true, 'SKILL.md',
    'Authorization: 请从环境变量读取认证信息，不在技能文件中保存凭证。\n'),
  fixture('natural-language-api-key-note', true, 'SKILL.md',
    'api_key: 由运行时环境提供，缺失时报告配置问题。\n'),
  fixture('yaml-token-property', true, 'SKILL.md',
    'metadata:\n  authentication:\n    token:\n      environmentVariable: GENERIC_TOKEN\n'),
  fixture('yaml-description-token-word', true, 'SKILL.md',
    'description: A generic helper that obtains a token from the environment.\nmetadata:\n  environmentVariable: GENERIC_TOKEN\n'),
  fixture('environment-variable-name', true, 'SKILL.md',
    'Required variable: `GENERIC_TOKEN_*`. Values are supplied at runtime.\n'),
  fixture('javascript-env-access', true, 'scripts/sample.mjs',
    'const token = process.env.GENERIC_TOKEN;\n'),
  fixture('javascript-env-bracket-access', true, 'scripts/sample.mjs',
    'const token = process.env["GENERIC_TOKEN"];\n'),
  fixture('python-os-getenv', true, 'scripts/sample.py',
    'import os\ntoken = os.getenv("GENERIC_TOKEN")\n'),
  fixture('python-environ-get-empty-default', true, 'scripts/sample.py',
    'import os\ntoken = os.environ.get("GENERIC_TOKEN", "")\n'),
  fixture('python-urllib-parse-call', true, 'scripts/sample.py',
    'import os, urllib.parse\ntoken = urllib.parse.unquote(os.getenv("GENERIC_TOKEN", ""))\n'),
  fixture('python-string-member-call', true, 'scripts/sample.py',
    'token = generic_response.strip()\n'),
  fixture('python-json-member-call', true, 'scripts/sample.py',
    'import json\ntoken = json.loads(generic_response).get("token")\n'),
  fixture('python-string-function-call', true, 'scripts/sample.py',
    'token = str(generic_value).strip()\n'),
  fixture('shell-simple-environment-reference', true, 'scripts/sample.sh',
    'GENERIC_TOKEN="$GENERIC_TOKEN"\n'),
  fixture('shell-nested-empty-fallback', true, 'scripts/sample.sh',
    'GENERIC_TOKEN=${GENERIC_TOKEN:-${GENERIC_FALLBACK_TOKEN:-}}\n'),
  fixture('shell-nested-required-reference', true, 'scripts/sample.sh',
    'GENERIC_TOKEN=${GENERIC_TOKEN:-${GENERIC_FALLBACK_TOKEN:?set an environment variable}}\n'),
  fixture('backtick-environment-documentation', true, 'references/config.md',
    'token: `process.env.GENERIC_TOKEN`\n'),
  fixture('backtick-placeholder-documentation', true, 'references/config.md',
    'token: `<GENERIC_TOKEN>`\n'),
  fixture('documentation-token-instructions-url', true, 'SKILL.md',
    'Obtain a token: https://example.invalid/documentation/authentication\n'),
  fixture('home-path-reference-documentation', true, 'SKILL.md',
    'token: ~/generic-authentication-cache\n'),
  fixture('hardcoded-opaque-token', false, 'scripts/sample.py',
    `token = "${opaqueLiteral}"\n`),
  fixture('hardcoded-opaque-authorization', false, 'scripts/sample.mjs',
    `const authorization = "${opaqueLiteral}";\n`),
  fixture('hardcoded-known-token-signature', false, 'scripts/sample.py',
    `token = "${knownSignature}"\n`),
  fixture('hardcoded-doc-token', false, 'SKILL.md',
    `token: ${opaqueLiteral}\n`),
  fixture('shell-literal-default', false, 'scripts/sample.sh',
    `GENERIC_TOKEN=\${GENERIC_TOKEN:-${opaqueLiteral}}\n`),
  fixture('shell-nested-literal-default', false, 'scripts/sample.sh',
    `GENERIC_TOKEN=\${GENERIC_TOKEN:-\${GENERIC_FALLBACK_TOKEN:-${opaqueLiteral}}}\n`),
  fixture('javascript-literal-default', false, 'scripts/sample.mjs',
    `const token = process.env.GENERIC_TOKEN || "${opaqueLiteral}";\n`),
  fixture('python-literal-default', false, 'scripts/sample.py',
    `import os\ntoken = os.getenv("GENERIC_TOKEN", "${opaqueLiteral}")\n`),
];

const results = [];
try {
  for (const item of cases) {
    const source = join(sourceRoot, item.name);
    mkdirSync(source, { recursive: true });
    const manifest = `---\nname: ${item.name}\ndescription: Public syntax regression fixture.\n---\n\n# Generic fixture\n`;
    writeFileSync(join(source, 'SKILL.md'), manifest + (item.file === 'SKILL.md' ? item.body : ''));
    if (item.file !== 'SKILL.md') {
      const target = join(source, item.file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, item.body);
    }
    const sourceBefore = readFileSync(join(source, item.file), 'utf8');
    let imported = false;
    let rejectedAsCredential = false;
    let unexpectedFailure = false;
    try {
      const importedSkill = catalog.importPath(source, item.name, 'path', 'copy');
      imported = true;
      assert.equal(importedSkill.name, item.name);
      assert.equal(lstatSync(source).isSymbolicLink(), false);
      assert.equal(readFileSync(join(source, item.file), 'utf8'), sourceBefore);
    } catch (error) {
      // Never print exception text; some scanner implementations may expose data.
      rejectedAsCredential = /credential|secret|private.?key/i.test(String(error?.message ?? ''));
      unexpectedFailure = !rejectedAsCredential;
    }
    const correctlyRejected = !imported && rejectedAsCredential && !unexpectedFailure;
    const partialRepositoryExists = !imported && existsSync(join(home, 'skills', item.name));
    const passed = item.allowed ? imported : correctlyRejected && !partialRepositoryExists;
    results.push({
      name: item.name,
      expected: item.allowed ? 'allow_public_reference' : 'reject_synthetic_literal',
      observed: imported ? 'imported' : correctlyRejected ? 'credential_rejected' : 'unexpected_failure',
      passed,
      ...(partialRepositoryExists ? { partialRepositoryExists: true } : {}),
    });
  }
} finally {
  catalog.close();
  rmSync(temporaryRoot, { recursive: true, force: true });
}
const report = {
  purpose: 'Supplemental public syntax cases; no source excerpts or credential values included.',
  tests: results.length,
  passed: results.filter(result => result.passed).length,
  failed: results.filter(result => !result.passed).length,
  withheld: [
    'Uncertain original test-file literals are deliberately not covered by any allow case.',
    'A credential-looking literal is never allowed solely because it occurs in tests or documentation.',
    'References to runtime credential files are modeled only as generic path strings; no file is opened.',
  ],
  results,
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exitCode = report.failed ? 1 : 0;
