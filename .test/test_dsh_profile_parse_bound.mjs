import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'

const settings = pathToFileURL(resolve('dist/core/settings.js')).href
const script = `
  import {updateProfileConfig} from ${JSON.stringify(settings)};
  const line = '-' + ' '.repeat(200000) + 'x\u2028tail';
  const result = updateProfileConfig(line, 'agent-default-model', ['provider: deepseek-official', 'model: fixture']);
  if (!result.includes('agent-default-model')) process.exit(1);
`
const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
  encoding: 'utf8', timeout: 3000,
})
assert.ifError(child.error)
assert.equal(child.status, 0, child.stderr)
console.log('Profile parsing completes within the bounded child-process timeout')
