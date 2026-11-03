import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Keep child programs literal; test values must be passed separately through argv.
const path = 'src/test/verification-timeout.test.ts';
const text = readFileSync(path, 'utf8');
const programs = [...text.matchAll(/\[\s*(['"])-e\1\s*,\s*(['"`])/g)];
assert.ok(programs.length >= 3, 'Expected the timeout and exit-code child fixtures');
for (const match of programs) {
  const quote = match[2];
  const start = match.index + match[0].length;
  let closed = false;
  for (let index = start; index < text.length; index++) {
    if (text[index] === '\\') { index++; continue; }
    if (text[index] === quote) { closed = true; break; }
    assert.ok(quote !== '`' || text.slice(index, index + 2) !== '${',
      'Child JavaScript must be fixed; pass output paths and exit codes through argv');
  }
  assert.ok(closed, 'Child program literal must terminate');
}
console.log(`Verified ${programs.length} fixed child-process programs`);
