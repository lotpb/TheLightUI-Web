// Runs every Firestore rules test against the already-running emulator.
//
// `npm run test:rules` starts the emulator and invokes this. It used to list
// each rules-tests/*.mjs script by name, so a new script only ran once someone
// remembered to append it — and companySettings.mjs and pickerLists.mjs were
// written and never wired in, while the 818-check vitest suite dropped out of
// CI entirely when the line was rewritten. Discovering the scripts instead
// means adding one is enough.
//
// Every suite runs even after a failure, so one run shows every broken rule
// rather than just the first. Exits non-zero if any suite failed.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const scriptsDir = join(root, 'rules-tests')

const suites = [
  {
    name: 'tests/rules (vitest)',
    cmd: process.execPath,
    args: [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.rules.config.ts'],
  },
  ...readdirSync(scriptsDir)
    .filter(f => f.endsWith('.mjs'))
    .sort()
    .map(f => ({ name: `rules-tests/${f}`, cmd: process.execPath, args: [join(scriptsDir, f)] })),
]

const results = []
for (const suite of suites) {
  console.log(`\n━━━ ${suite.name} ━━━`)
  const { status } = spawnSync(suite.cmd, suite.args, { cwd: root, stdio: 'inherit' })
  results.push({ name: suite.name, ok: status === 0 })
}

console.log('\n━━━ Rules test summary ━━━')
for (const r of results) console.log(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.name}`)
const failed = results.filter(r => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} suites passed`)
process.exit(failed ? 1 : 0)
