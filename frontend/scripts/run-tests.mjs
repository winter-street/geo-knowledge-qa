import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createServer } from 'vite'

function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return findTests(path)
    return /\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function run(command, argumentsList) {
  const result = spawnSync(command, argumentsList, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const tests = findTests(join(process.cwd(), 'src')).sort()
if (tests.length === 0) {
  console.error('No frontend TypeScript tests were found.')
  process.exit(1)
}

const vitestTests = tests.filter((test) => readFileSync(test, 'utf8').includes("from 'vitest'"))
const assertionTests = tests.filter((test) => !vitestTests.includes(test))

if (vitestTests.length > 0) {
  console.log(`==> Vitest: ${vitestTests.map((test) => relative(process.cwd(), test)).join(', ')}`)
  run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...vitestTests])
}

if (assertionTests.length > 0) {
  const server = await createServer({ appType: 'custom', server: { middlewareMode: true } })
  try {
    for (const test of assertionTests) {
      console.log(`==> ${relative(process.cwd(), test)}`)
      await server.ssrLoadModule(`/${relative(process.cwd(), test).replaceAll('\\', '/')}`)
    }
  } finally {
    await server.close()
  }
}
