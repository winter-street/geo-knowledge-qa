import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return findTests(path)
    return /\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const tests = findTests(join(process.cwd(), 'src')).sort()
if (tests.length === 0) {
  console.error('No backend TypeScript tests were found.')
  process.exit(1)
}

for (const test of tests) {
  console.log(`==> ${relative(process.cwd(), test)}`)
  const result = spawnSync(process.execPath, ['--import', 'tsx', test], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
