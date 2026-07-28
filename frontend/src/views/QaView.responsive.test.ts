import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const qaView = readFileSync(new URL('./QaView.vue', import.meta.url), 'utf8')
const userLayout = readFileSync(new URL('../layouts/UserLayout.vue', import.meta.url), 'utf8')
const chatInput = readFileSync(new URL('../components/ChatInput.vue', import.meta.url), 'utf8')

describe('mobile QA layout contract', () => {
  it('reflows the conversation rail above the question workspace', () => {
    expect(qaView).toMatch(/@media \(max-width: 760px\)[\s\S]*\.qa-layout\s*{[\s\S]*flex-direction:\s*column/)
    expect(qaView).toMatch(/@media \(max-width: 760px\)[\s\S]*\.qa-sidebar\s*{[\s\S]*width:\s*100%/)
    expect(qaView).toMatch(/@media \(max-width: 760px\)[\s\S]*\.conv-list\s*{[\s\S]*display:\s*flex/)
  })

  it('keeps navigation and Agent controls usable without horizontal overflow', () => {
    expect(userLayout).toMatch(/@media \(max-width: 760px\)[\s\S]*\.nav-tab span\s*{\s*display:\s*none/)
    expect(chatInput).toMatch(/@media \(max-width: 760px\)[\s\S]*\.mode-bar\s*{[\s\S]*flex-wrap:\s*wrap/)
    expect(chatInput).toMatch(/@media \(max-width: 760px\)[\s\S]*\.send-btn\s*{[\s\S]*width:\s*44px/)
  })
})
