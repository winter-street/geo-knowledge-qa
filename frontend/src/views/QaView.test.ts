import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./QaView.vue', import.meta.url), 'utf8')

describe('QaView map handoff contract', () => {
  it('contains no embedded map or development injection entry', () => {
    expect(source).not.toContain('AMapLoader')
    expect(source).not.toContain('qa-map-panel')
    expect(source).not.toContain('activeSpatial')
    expect(source).not.toContain('绀轰緥绌洪棿鏁版嵁')
    expect(source).not.toContain('injectMock')
  })

  it('hands a message to the dedicated map page', () => {
    expect(source).toContain('createMessageMapPlan')
    expect(source).toContain('spatialTask.accept(plan, message.spatialData, message.spatialAnalysis)')
    expect(source).toContain("@open-map=\"openMessageMap($event, store.currentMessages[idx - 1]?.content || '')\"")
    expect(source).toContain("query: { task: plan.id }")
  })
})
