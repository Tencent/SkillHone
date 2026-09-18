import { chmod, cp, mkdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const executable = process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
const localCompiler = process.env.SKILLHONE_TSC_PATH
  ? resolve(process.env.SKILLHONE_TSC_PATH)
  : resolve(root, 'node_modules', '.bin', executable)
const probe = spawnSync(localCompiler, ['--version'], { cwd: root, stdio: 'ignore' })
if (probe.status !== 0) {
  console.error('TypeScript build dependencies are missing; install the locked dependencies before building.')
  process.exit(1)
}
await rm(resolve(root, 'dist'), { recursive: true, force: true })
const compilerArgs = ['-p', 'tsconfig.json']
if (process.env.SKILLHONE_NODE_TYPES_PATH) {
  compilerArgs.push('--typeRoots', resolve(process.env.SKILLHONE_NODE_TYPES_PATH))
}
const result = spawnSync(localCompiler, compilerArgs, { cwd: root, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
await mkdir(resolve(root, 'dist', 'web'), { recursive: true })
for (const name of ['index.html', 'styles.css']) {
  await cp(resolve(root, 'src', 'web', name), resolve(root, 'dist', 'web', name))
}
await chmod(resolve(root, 'dist', 'cli.js'), 0o755)
