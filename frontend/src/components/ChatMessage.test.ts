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
