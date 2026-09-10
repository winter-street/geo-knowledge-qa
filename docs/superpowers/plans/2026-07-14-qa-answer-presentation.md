# QA Answer Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ordinary QA answers concise and readable, collapse supporting evidence by default, and replace the QA page's embedded map with one reliable “查看地图” handoff.

**Architecture:** Filter prompt context before LLM generation, keep Markdown and map-handoff behavior in tested pure utilities, simplify `ChatMessage`, and delete the second AMap implementation from `QaView` while reusing `spatialTask -> MapView`.

**Tech Stack:** TypeScript, Node.js, Express, Vue 3, Pinia, Vue Router, Vitest, tsx, Vite

## Global Constraints

- Ordinary answers target 300 to 500 Chinese characters: direct conclusion, 2 to 4 relevant points, at most one concluding sentence.
- Do not hard-truncate output; explicit detailed or spatial-analysis questions may be longer.
- Mock KG paths stay in response metadata for graph display but do not enter factual LLM context.
- Spatial analysis enters the prompt only when `interpretation.spatialIntent === true`.
- Keep one frontend demo-KG notice; do not append the same notice to answer prose.
- Do not change knowledge-graph behavior, the 40-node limit, or the dedicated map page's analysis tools.
- Do not stage unrelated DOCX, PPTX, assets, internship logs, or defense scripts.

---

### Task 1: Constrain Answers and Isolate Prompt Context

**Files:**
- Modify: `backend/src/services/llm.test.ts`
- Modify: `backend/src/services/llm.ts`

**Interfaces:**
- Consumes: existing `buildPrompt(question, ragChunks, kgContext, retrievalMode, spatialContext)`.
- Produces: a concise prompt containing real KG paths and only explicitly requested spatial context.

- [ ] **Step 1: Write failing prompt tests**

Replace `backend/src/services/llm.test.ts` with:

```ts
import assert from 'node:assert/strict'
import { buildPrompt } from './llm.js'
import type { SpatialAnalysis, SpatialData } from '../types/index.js'

const prompt = buildPrompt('攀枝花钒钛磁铁矿受哪些构造控制？', [], [
  { from: '磁铁矿', relation: '赋存于', relationType: 'HOSTED_IN', to: '辉长岩' },
  {
    from: '攀枝花钒钛磁铁矿', relation: '受控于', relationType: 'CONTROLLED_BY',
    to: '演示断裂', isMock: true, source: 'spatial-demo-v1',
  },
], 'kg')

assert.match(prompt, /「磁铁矿」—\[赋存于\]→「辉长岩」/)
assert.doesNotMatch(prompt, /演示断裂|spatial-demo-v1/)
assert.match(prompt, /开头用 1 至 2 句话直接回答/)
assert.match(prompt, /2 至 4 个无序要点/)
assert.match(prompt, /300 至 500 个汉字/)
assert.doesNotMatch(prompt, /在回答末尾用列表列出关键地质实体/)
assert.doesNotMatch(prompt, /可以补充.*现有资料还覆盖/)

function spatialContext(spatialIntent: boolean): { data: SpatialData; analysis: SpatialAnalysis } {
  return {
    data: { markers: [{ id: 'm1', name: '测试矿点', type: 'Mineral', lng: 102, lat: 27 }], polylines: [] },
    analysis: {
      interpretation: {
        originalText: '测试问题', spatialIntent, entityTypes: ['Mineral'], mineralKinds: [],
        timePeriods: [], depositTypes: [], owlTypes: [], sortBy: 'name',
      },
      summary: {
        candidateCount: 1, matchedCount: 1, pointCount: 1, lineCount: 0, mockCount: 0,
        highProspectivityCount: 0, mediumProspectivityCount: 0, lowProspectivityCount: 0,
      },
      temporal: { buckets: [], unknownEraCount: 1 },
      regions: [],
      warnings: [],
    },
  }
}

assert.doesNotMatch(buildPrompt('介绍矿床构造', [], [], 'hybrid', spatialContext(false)), /空间分析上下文/)
assert.match(buildPrompt('测试矿点在哪里？', [], [], 'hybrid', spatialContext(true)), /空间分析上下文/)
console.log('[PASS] LLM prompt keeps answers concise and isolates demo/spatial context')
```

- [ ] **Step 2: Verify RED**

Run: `cd backend; npx.cmd tsx src/services/llm.test.ts`

Expected: FAIL because the current prompt includes mock KG data, key-entity instructions, and non-spatial spatial context.

- [ ] **Step 3: Filter prompt inputs**

In `buildPrompt()` add:

```ts
const factualKgContext = kgContext.filter((path) => !path.isMock)
```

Build `kgSection` from `factualKgContext` and remove mock-source formatting plus the instruction to preserve `DEMO_KG_DISCLAIMER`. Replace the current spatial-section condition:

```ts
// Before
if (spatialContext && spatialContext.analysis.summary.matchedCount > 0) {

// After
if (spatialContext
  && spatialContext.analysis.interpretation.spatialIntent
  && spatialContext.analysis.summary.matchedCount > 0) {
```

- [ ] **Step 4: Replace answer rules and remove duplicate suffixes**

Set `SYSTEM_PROMPT` to:

```ts
export const SYSTEM_PROMPT =
  '你是专业的地质找矿知识问答助手。必须基于提供的地质文献和真实知识图谱证据回答。先给结论，再解释与问题直接相关的要点；不堆砌检索片段，不重复界面已经展示的来源、本体、图谱或地图信息。信息不完整时说明证据边界，完全没有相关信息时才说明知识库暂未收录。地学术语首次出现时可附一句简释。'
```

Replace `## 回答要求` with exactly these rules:

```text
1. 开头用 1 至 2 句话直接回答用户问题
2. 仅在确有多个并列结论时使用 2 至 4 个无序要点，每个要点不超过 2 句
3. 普通问题以 300 至 500 个汉字为目标；复杂对比、空间分析或明确要求详细说明时可以更长
4. 只保留与问题直接相关的证据，不主动扩展岩体尺寸、矿段清单、围岩机制或空间统计
5. 结尾最多使用 1 句总结，不列“关键地质实体”，不重复界面组件已经展示的信息
6. 禁止用“根据您提供的资料”开头，禁止用“现有资料还覆盖了以下相关信息”扩写
7. OWL类别只表示对应证据存在，不得据此虚构成因或把围岩年代当作成矿年代
8. 空间结果只在明确的位置、范围、距离、地图或空间分析问题中用于正文
```

Delete `DEMO_KG_DISCLAIMER`, `ensureKgDisclaimer()`, the non-stream wrapper that calls it, and the streaming `onDone` suffix append. Provider answers return unchanged; mock provenance remains in `kgContext` for `ChatMessage`.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```powershell
npx.cmd tsx src/services/llm.test.ts
npm.cmd run build
```

Expected: test PASS line and TypeScript build exit 0.

Commit:

```powershell
git add backend/src/services/llm.ts backend/src/services/llm.test.ts
git commit -m "优化：收敛问答内容与证据上下文"
```

---

### Task 2: Recover List Numbers and Create Lightweight Map Plans

**Files:**
- Modify: `frontend/src/utils/markdown.test.ts`
- Modify: `frontend/src/utils/markdown.ts`
- Modify: `frontend/src/utils/map-plan.test.ts`
- Modify: `frontend/src/utils/map-plan.ts`

**Interfaces:**
- Produces: correct `<ol start="N">` when numbered items are split by blank lines.
- Produces: `createMessageMapPlan(messageId: string, question: string): MapPlan`.

- [ ] **Step 1: Write the failing Markdown test**

Append inside `describe('renderMarkdown', ...)`:

```ts
it('preserves ordered-list numbers when blank lines split the list', () => {
  const html = renderMarkdown('1. 第一项\n\n2. 第二项\n\n3. 第三项')
  expect(html).toContain('<ol>\n<li>第一项</li>\n</ol>')
  expect(html).toContain('<ol start="2">\n<li>第二项</li>\n</ol>')
  expect(html).toContain('<ol start="3">\n<li>第三项</li>\n</ol>')
})
```

- [ ] **Step 2: Verify Markdown RED**

Run: `cd frontend; npx.cmd vitest run src/utils/markdown.test.ts`

Expected: FAIL because every new `<ol>` currently starts at 1.

- [ ] **Step 3: Preserve explicit starts**

Replace the ordered-list block in `renderMarkdown()`:

```ts
const ol = line.match(/^\s*(\d+)\.\s+(.*)$/)
if (ol) {
  if (listType !== 'ol') {
    closeList()
    const start = Number(ol[1])
    html.push(start > 1 ? `<ol start="${start}">` : '<ol>')
    listType = 'ol'
  }
  html.push(`<li>${renderInline(ol[2] ?? '')}</li>`)
  continue
}
```

- [ ] **Step 4: Write the failing lightweight-plan test**

Import `createMessageMapPlan` in `map-plan.test.ts`, then append:

```ts
const messagePlan = createMessageMapPlan('msg-123', '攀枝花钒钛磁铁矿受哪些构造控制？')
assert.deepEqual(messagePlan, {
  id: 'qa-msg-123', version: 1, title: '问答空间结果', autoExecute: true, openFullMap: false,
  actions: [
    { type: 'query', question: '攀枝花钒钛磁铁矿受哪些构造控制？' },
    { type: 'fit-bounds' },
  ],
  warnings: [],
})
assert.deepEqual(createMessageMapPlan('msg-123', '攀枝花钒钛磁铁矿受哪些构造控制？'), messagePlan)
```

- [ ] **Step 5: Verify map-plan RED**

Run: `npx.cmd tsx src/utils/map-plan.test.ts`

Expected: FAIL because `createMessageMapPlan` is missing.

- [ ] **Step 6: Implement the lightweight plan**

Add to `map-plan.ts`:

```ts
export function createMessageMapPlan(messageId: string, question: string): MapPlan {
  return {
    id: `qa-${messageId}`,
    version: 1,
    title: '问答空间结果',
    autoExecute: true,
    openFullMap: false,
    actions: [
      { type: 'query', question: question.trim() || '查看问答空间结果' },
      { type: 'fit-bounds' },
    ],
    warnings: [],
  }
}
```

- [ ] **Step 7: Verify and commit**

Run:

```powershell
npx.cmd vitest run src/utils/markdown.test.ts
npx.cmd tsx src/utils/map-plan.test.ts
npm.cmd test
```

Expected: all commands pass.

Commit:

```powershell
git add frontend/src/utils/markdown.ts frontend/src/utils/markdown.test.ts frontend/src/utils/map-plan.ts frontend/src/utils/map-plan.test.ts
git commit -m "修复：保持回答编号并准备地图跳转"
```

---

### Task 3: Collapse Evidence and Expose One Map Action

**Files:**
- Create: `frontend/src/components/ChatMessage.test.ts`
- Modify: `frontend/src/components/ChatMessage.vue`

**Interfaces:**
- Replaces component events `show-map`, `open-full-map`, and `clear-map-plan`.
- Produces one event: `'open-map': [message: Message]`.
- Leaves `KgMiniGraph` props and behavior unchanged.

- [ ] **Step 1: Write a failing SFC presentation contract test**

Create `frontend/src/components/ChatMessage.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ChatMessage.vue', import.meta.url), 'utf8')

describe('ChatMessage presentation contract', () => {
  it('uses default-closed evidence sections', () => {
    expect(source.match(/<details\b/g)).toHaveLength(3)
    expect(source).toContain('参考来源')
    expect(source).toContain('本体推理')
    expect(source).toContain('空间分析')
    expect(source).not.toMatch(/<details[^>]*\bopen\b/)
  })

  it('exposes one map action and removes legacy map controls', () => {
    expect(source.match(/查看地图/g)).toHaveLength(1)
    expect(source).not.toContain('在地图上查看')
    expect(source).not.toContain('完整地图')
    expect(source).not.toContain('已自动执行')
    expect(source).toContain("'open-map': [message: Message]")
  })
})
```

- [ ] **Step 2: Verify component RED**

Run: `cd frontend; npx.cmd vitest run src/components/ChatMessage.test.ts`

Expected: FAIL because the current component has no `<details>`, uses legacy map labels, and emits three old events.

- [ ] **Step 3: Replace map event state**

Use:

```ts
const emit = defineEmits<{ 'open-map': [message: Message] }>()
const hasMapResult = computed(() => geoCount.value > 0)
const planLabels = computed(() => props.message.mapPlan ? mapPlanLabels(props.message.mapPlan) : [])

function handleOpenMap() {
  if (hasMapResult.value) emit('open-map', props.message)
}
```

Remove the `requiresFullMap` import, `planNeedsFullMap`, and the three old map handlers.
Reduce the type import to `import type { Message } from '@/types'` because `MapPlan` and `SpatialData` are no longer referenced directly.

- [ ] **Step 4: Convert supporting evidence to default-closed details**

Replace the current source wrapper, OWL `<section>`, and spatial `<section>` with `<details class="evidence-details">` wrappers without an `open` attribute. Move their current inner lists/rows into `.evidence-details-body` and use these summaries:

```vue
<summary><span>参考来源</span><small>{{ message.sources.length }} 条</small></summary>
<summary><span>本体推理</span><small>{{ owlEvidence.length }} 类 · {{ owlEntityCount }} 个实体</small></summary>
<summary><span>空间分析</span><small>{{ spatialSummary.pointCount }} 个点 · {{ spatialSummary.lineCount }} 条线</small></summary>
```

Keep `SourceCard`, OWL rows, and spatial statistics inside `.evidence-details-body`. Keep the single `.kg-demo-note`. Do not change `KgMiniGraph`.

- [ ] **Step 5: Replace both map controls with one row**

Delete `.map-plan-status` and the old “在地图上查看” block. Add:

```vue
<div v-if="hasMapResult" class="map-action">
  <button type="button" class="map-cta" @click="handleOpenMap">
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <circle cx="10" cy="8" r="2.5" />
      <path d="M10 17s-5-4.5-5-9a5 5 0 1110 0c0 4.5-5 9-5 9z" />
    </svg>
    查看地图
  </button>
  <span>{{ geoCount }} 处标注</span>
  <small v-if="planLabels.length">{{ planLabels.join(' · ') }}</small>
</div>
```

- [ ] **Step 6: Apply the readable layout**

Set assistant message width to `min(100%, 820px)`, keep user messages at `max-width: 700px`, set `.content { width: 100%; }`, and change `.bubble` to `font-size: 15px; line-height: 1.75; text-wrap: pretty`.

Add:

```css
.evidence-details { margin-top: 12px; border-top: 1px solid var(--color-ink-100); }
.evidence-details > summary { min-height: 38px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--color-ink-700); font-size: 12px; font-weight: 600; cursor: pointer; list-style: none; }
.evidence-details > summary::-webkit-details-marker { display: none; }
.evidence-details > summary small { color: var(--color-ink-300); font-size: 10px; font-weight: 400; }
.evidence-details-body { padding: 0 0 10px; }
.map-action { display: flex; align-items: center; gap: 10px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--color-ink-100); color: var(--color-ink-400); font-size: 11px; }
.map-action small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

Remove styles used only by old extra labels and map-plan status controls.

- [ ] **Step 7: Verify GREEN, compile, and commit**

Run:

```powershell
cd frontend
npx.cmd vitest run src/components/ChatMessage.test.ts
npm.cmd run type-check
npm.cmd run build
```

Expected: both exit 0.

Commit:

```powershell
git add frontend/src/components/ChatMessage.vue frontend/src/components/ChatMessage.test.ts
git commit -m "优化：折叠问答证据并统一地图入口"
```

---

### Task 4: Delete the Embedded QA Map and Route to MapView

**Files:**
- Create: `frontend/src/views/QaView.test.ts`
- Modify: `frontend/src/views/QaView.vue`
- Modify: `frontend/src/utils/spatial.ts`

**Interfaces:**
- Consumes `createMessageMapPlan()` and the `open-map` message event.
- Produces a role-correct route with `task=<planId>` and a matching `spatialTask` snapshot.

- [ ] **Step 1: Write a failing QA-map removal contract test**

Create `frontend/src/views/QaView.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./QaView.vue', import.meta.url), 'utf8')

describe('QaView map handoff contract', () => {
  it('contains no embedded map or development injection entry', () => {
    expect(source).not.toContain('AMapLoader')
    expect(source).not.toContain('qa-map-panel')
    expect(source).not.toContain('activeSpatial')
    expect(source).not.toContain('示例空间数据')
    expect(source).not.toContain('injectMock')
  })

  it('hands a message to the dedicated map page', () => {
    expect(source).toContain('createMessageMapPlan')
    expect(source).toContain('spatialTask.accept(plan, message.spatialData, message.spatialAnalysis)')
    expect(source).toContain("@open-map=\"openMessageMap($event, store.currentMessages[idx - 1]?.content || '')\"")
    expect(source).toContain("query: { task: plan.id }")
  })
})
```

- [ ] **Step 2: Verify QA-map RED**

Run: `cd frontend; npx.cmd vitest run src/views/QaView.test.ts`

Expected: FAIL because `QaView` still imports AMap, renders `.qa-map-panel`, and exposes the example-data button.

- [ ] **Step 3: Replace embedded-map imports**

Keep normal QA imports, add:

```ts
import { createMessageMapPlan } from '@/utils/map-plan'
import type { Message } from '@/types'
```

Remove `nextTick`, `watch`, `AMapLoader`, spatial-rendering helpers, AMap constraints, `SpatialData`, and `MapPlan` imports.

- [ ] **Step 4: Add one message handoff**

```ts
async function openMessageMap(message: Message, question: string) {
  if (!message.spatialData) return
  const plan = message.mapPlan ?? createMessageMapPlan(message.id, question)
  spatialTask.accept(plan, message.spatialData, message.spatialAnalysis)
  const routeName = localStorage.getItem('role') === 'admin' ? 'AdminMap' : 'UserMap'
  await router.push({ name: routeName, query: { task: plan.id } })
}
```

Bind it with:

```vue
@open-map="openMessageMap($event, store.currentMessages[idx - 1]?.content || '')"
```

- [ ] **Step 5: Delete the entire embedded-map runtime**

Delete all QA-map state, latest-spatial watchers, AMap initialization, overlays, layer controls, inline-map open/close functions, automatic full-map watcher, and `injectMock()`. Reduce `onUnmounted()` to:

```ts
onUnmounted(() => window.removeEventListener('click', onWindowClick))
```

- [ ] **Step 6: Delete map/example markup and CSS**

Delete the complete `.qa-map-panel` template, the `dev-mock-btn`, and their styles, including fallback-list, layer-chip, marker, map-body, and mock-button selectors. Remove the old three map events from `ChatMessage` usage and keep only `@open-map`.

- [ ] **Step 7: Remove the QA-only mock presets**

In `spatial.ts`, change the import to `import type { SpatialData } from '@/types'`. Delete helper constructors `mineral`, `rock`, `structureLine`, and the exported `mockSpatialPresets`. Keep category helpers, `hasGeo`, and `collectCategories`.

- [ ] **Step 8: Verify GREEN and removal boundaries**

Run:

```powershell
$forbidden = @(Select-String -Path frontend/src/views/QaView.vue,frontend/src/utils/spatial.ts -Pattern 'AMapLoader|qa-map-panel|示例空间数据|mockSpatialPresets|activeSpatial|openFullMap')
if ($forbidden.Count -gt 0) { $forbidden; throw 'QA embedded-map code still exists' }
npx.cmd vitest run src/views/QaView.test.ts
npx.cmd tsx src/utils/map-plan.test.ts
npm.cmd run type-check
npm.cmd run build
```

Expected: the forbidden-pattern assertion is silent; all test and build commands pass.

- [ ] **Step 9: Commit**

```powershell
git add frontend/src/views/QaView.vue frontend/src/views/QaView.test.ts frontend/src/utils/spatial.ts
git commit -m "优化：移除问答页内嵌地图与示例入口"
```

---

### Task 5: Full Verification and Manual Workflow

**Files:**
- Verify only; no planned production changes.

- [ ] **Step 1: Run fresh automated verification**

```powershell
cd backend
npx.cmd tsx src/services/llm.test.ts
npm.cmd run build

cd ..\frontend
npx.cmd vitest run src/utils/markdown.test.ts
npx.cmd vitest run src/utils/kg-graph.test.ts
npx.cmd tsx src/utils/map-plan.test.ts
npm.cmd test
npm.cmd run type-check
npm.cmd run build
```

Expected: every command exits 0. Existing Vite dependency-annotation and large-chunk warnings may remain.

- [ ] **Step 2: Check scope**

Run `git diff --check`, `git status --short`, and `git diff --stat master...HEAD`.

Expected: only Tasks 1 through 4 files differ; unrelated main-worktree documents are absent.

- [ ] **Step 3: Verify in the browser**

Ask:

```text
攀枝花钒钛磁铁矿受哪些构造控制？
```

Verify: direct concise answer; no key-entity appendix; one demo notice; sources/OWL/spatial details closed; graph behavior unchanged; no embedded map or example button; exactly one “查看地图” action; click routes to the correct role map with this message's data; returning does not auto-open or redirect.
