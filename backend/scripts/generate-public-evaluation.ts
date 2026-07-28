import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPublicEvaluationSuite, buildSyntheticValidationRun } from '../src/services/evaluation/fixtures.js'
import { evaluateRun, renderEvaluationReport } from '../src/services/evaluation/metrics.js'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(backendRoot, 'evaluation', 'public')
const suite = buildPublicEvaluationSuite()
const validationRun = buildSyntheticValidationRun(suite)
const report = evaluateRun(validationRun, 'test')

await mkdir(outputDir, { recursive: true })
await Promise.all([
  writeFile(path.join(outputDir, 'suite.json'), `${JSON.stringify(suite, null, 2)}\n`, 'utf8'),
  writeFile(path.join(outputDir, 'synthetic-validation-run.json'), `${JSON.stringify(validationRun, null, 2)}\n`, 'utf8'),
  writeFile(path.join(outputDir, 'report.test.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  writeFile(path.join(outputDir, 'report.test.md'), renderEvaluationReport(report), 'utf8'),
])

console.log(`Generated privacy-safe evaluation assets in ${outputDir}`)
