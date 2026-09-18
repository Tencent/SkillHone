import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const executable = process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
const localCompiler = resolve(root, 'node_modules', '.bin', executable)
let compiler = localCompiler
let buildRoot

function buildInstallEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => {
    const normalized = key.toLowerCase()
    return normalized !== 'npm_config_allow_scripts'
      && normalized !== 'npm_config_strict_allow_scripts'
  }))
}

if (!existsSync(localCompiler)) {
  buildRoot = mkdtempSync(join(tmpdir(), 'skillhone-build-'))
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const npmCommand = process.env.npm_execpath ? process.execPath : npm
  const npmArgs = process.env.npm_execpath ? [process.env.npm_execpath] : []
  const installed = spawnSync(npmCommand, [...npmArgs,
    'install',
    '--prefix',
    buildRoot,
    '--global=false',
    '--location=project',
    '--no-save',
    '--package-lock=false',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--registry=https://registry.npmjs.org',
    'typescript@7.0.2',
    '@types/node@24.13.3',
  ], { cwd: buildRoot, stdio: 'inherit', env: buildInstallEnvironment() })
  compiler = resolve(buildRoot, 'node_modules', '.bin', executable)
  if (installed.status !== 0 || !existsSync(compiler)) {
    rmSync(buildRoot, { recursive: true, force: true })
    console.error('Unable to install the pinned TypeScript build dependencies for the Git source package.')
    process.exit(installed.status ?? 1)
  }
}

const built = spawnSync(process.execPath, ['scripts/build-ts.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    SKILLHONE_TSC_PATH: compiler,
    ...(buildRoot ? { SKILLHONE_NODE_TYPES_PATH: resolve(buildRoot, 'node_modules', '@types') } : {}),
  },
})
if (buildRoot) rmSync(buildRoot, { recursive: true, force: true })
process.exit(built.status ?? 1)
