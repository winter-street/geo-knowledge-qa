import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../src/config.js'
import {
  buildFrozenPrivateSuite,
  privateEvidencePackSchema,
  validateFrozenSuiteReferences,
  validatePrivateSnapshot,
  type PrivateDataSnapshot,
} from '../src/services/evaluation/private-curation.js'
import {
  exportPrivateCurationAssets,
  buildCandidatePromptBatch,
  loadPrivateCorpus,
  renderReviewedCandidatePrompts,
  renderCandidateReviewCsv,
  parseCandidateReviewCsv,
} from '../src/services/evaluation/private-curation-io.js'
import { createPrivateNeo4jGraphProvider } from '../src/services/evaluation/private-curation-neo4j.js'
import {
  assertFrozenSuitePrivacy,
  assertPrivateEvaluationOutputPath,
  parseCurationCommand,
  parsePrivateCandidateJsonLines,
  resolveCurationPath,
  validateAcceptedCurationRecords,
  validateAcceptedEvidenceReferences,
} from '../src/services/evaluation/private-curation-workflow.js'
import { hashPrivateSuite } from '../src/services/evaluation/private-quality.js'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(backendRoot, '..')

function localPath(value: string): string {
  return resolveCurationPath(value, backendRoot, repositoryRoot)
}

async function loadSnapshot(filePath: string): Promise<PrivateDataSnapshot> {
  const snapshot = JSON.parse(await readFile(localPath(filePath), 'utf8')) as PrivateDataSnapshot
  validatePrivateSnapshot(snapshot)
  return snapshot
}

async function loadCandidates(filePath: string) {
  return parsePrivateCandidateJsonLines(await readFile(localPath(filePath), 'utf8'))
}

async function loadEvidencePacks(filePath: string) {
  return (await readFile(localPath(filePath), 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try { return privateEvidencePackSchema.parse(JSON.parse(line)) } catch (error) {
        throw new Error(`Invalid evidence JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
}

async function main(): Promise<void> {
  const command = parseCurationCommand(process.argv.slice(2))
  if (command.command === 'export') {
    const dbPath = localPath(command.dbPath)
    const outputDirectory = localPath(command.outputDirectory)
    assertPrivateEvaluationOutputPath(outputDirectory, backendRoot)
    const corpus = loadPrivateCorpus(dbPath)
    const graphProvider = createPrivateNeo4jGraphProvider({
      ...config.neo4j,
      documents: corpus.documents,
    })
    try {
      const result = await exportPrivateCurationAssets({
        dbPath,
        outputDirectory,
        graphProvider,
      })
      console.log(JSON.stringify({
        snapshotHash: result.snapshot.snapshotHash,
        documentCount: result.snapshot.documentCount,
        uniqueDocumentCount: result.snapshot.uniqueDocumentCount,
        chunkCount: result.snapshot.chunkCount,
        graphAvailable: result.snapshot.graph.available,
        graphNodeCount: result.snapshot.graph.nodeCount,
        graphRelationshipCount: result.snapshot.graph.relationshipCount,
        evidencePackCount: result.evidencePacks.length,
      }, null, 2))
    } catch (error) {
      if (!command.allowMissingNeo4j) throw error
      const result = await exportPrivateCurationAssets({
        dbPath,
        outputDirectory,
      })
      console.warn('[private-curation] Neo4j unavailable; exported document-only evidence packs by explicit request.')
      console.log(JSON.stringify({
        snapshotHash: result.snapshot.snapshotHash,
        documentCount: result.snapshot.documentCount,
        uniqueDocumentCount: result.snapshot.uniqueDocumentCount,
        chunkCount: result.snapshot.chunkCount,
        graphAvailable: false,
        evidencePackCount: result.evidencePacks.length,
      }, null, 2))
    }
    return
  }

  if (command.command === 'prompts') {
    const packs = await loadEvidencePacks(command.evidencePath)
    const batch = buildCandidatePromptBatch(packs)
    const outputPath = localPath(command.outputPath)
    assertPrivateEvaluationOutputPath(outputPath, backendRoot)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, batch.prompts.map((prompt) => JSON.stringify(prompt)).join('\n') + '\n', 'utf8')
    console.log(JSON.stringify({ ...batch.stats, outputFile: path.basename(outputPath) }, null, 2))
    return
  }

  if (command.command === 'review-export') {
    const records = await loadCandidates(command.candidatePath)
    const evidencePacks = await loadEvidencePacks(command.evidencePath)
    const outputPath = localPath(command.outputPath)
    assertPrivateEvaluationOutputPath(outputPath, backendRoot)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, renderCandidateReviewCsv(records, evidencePacks), 'utf8')
    console.log(JSON.stringify({ candidateCount: records.length, outputFile: path.basename(outputPath) }, null, 2))
    return
  }

  if (command.command === 'review-import') {
    const records = parseCandidateReviewCsv(await readFile(localPath(command.csvPath), 'utf8'))
    const outputPath = localPath(command.outputPath)
    assertPrivateEvaluationOutputPath(outputPath, backendRoot)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''), 'utf8')
    console.log(JSON.stringify({ candidateCount: records.length, outputFile: path.basename(outputPath) }, null, 2))
    return
  }

  const snapshot = await loadSnapshot(command.snapshotPath)
  const records = await loadCandidates(command.candidatePath)
  const evidencePacks = await loadEvidencePacks(command.evidencePath)
  validateAcceptedCurationRecords(records)
  validateAcceptedEvidenceReferences(records, evidencePacks)
  const suite = buildFrozenPrivateSuite({
    label: command.command === 'freeze' ? command.label : 'validation-only',
    frozenAt: snapshot.frozenAt,
    records,
    snapshot,
  })
  validateFrozenSuiteReferences(suite, snapshot)
  assertFrozenSuitePrivacy(suite)

  if (command.command === 'validate') {
    console.log(JSON.stringify({
      acceptedSingleTurnCases: suite.singleTurnCases.length,
      acceptedMultiTurnCases: suite.multiTurnCases.length,
      snapshotHash: snapshot.snapshotHash,
      status: 'valid',
    }, null, 2))
    return
  }

  const outputPath = localPath(command.outputPath)
  assertPrivateEvaluationOutputPath(outputPath, backendRoot)
  await mkdir(path.dirname(outputPath), { recursive: true })
  const suiteHash = hashPrivateSuite(suite)
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(suite, null, 2)}\n`, 'utf8'),
    writeFile(path.join(path.dirname(outputPath), 'freeze-manifest.private.json'), `${JSON.stringify({
      schemaVersion: '1.0',
      private: true,
      label: suite.label,
      frozenAt: suite.frozenAt,
      snapshotHash: snapshot.snapshotHash,
      sqliteSha256: snapshot.sqliteSha256,
      suiteHash,
      graphNodeCount: snapshot.graph.nodeCount,
      graphRelationshipCount: snapshot.graph.relationshipCount,
    }, null, 2)}\n`, 'utf8'),
  ])
  console.log(JSON.stringify({
    outputFile: path.basename(outputPath),
    singleTurnCases: suite.singleTurnCases.length,
    multiTurnCases: suite.multiTurnCases.length,
    snapshotHash: snapshot.snapshotHash,
    suiteHash,
  }, null, 2))
}

main().catch((error) => {
  console.error(`[private-curation] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
