import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ChatInput.vue', import.meta.url), 'utf8')

describe('ChatInput agent mode control', () => {
  it('exposes a two-mode Agent/Direct segmented control', () => {
    expect(source).toContain('agentMode: AgentMode')
    expect(source).toContain("'update:agentMode'")
    expect(source).toContain("{ value: 'agent', label: 'Agent' }")
    expect(source).toContain("{ value: 'direct', label: '直接问答' }")
  })
})
