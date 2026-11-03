import { spawnSync } from 'node:child_process'
const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', 'dist/test/native-execution.test.js', 'dist/test/workbench.test.js'], { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
