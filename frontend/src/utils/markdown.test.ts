/**
 * markdown.ts 单元测试
 *
 * 运行: npx vitest run src/utils/markdown.test.ts
 *
 * 覆盖: 标题 / 加粗 / 斜体 / 行内代码 / 代码块 / 无序列表 / 有序列表 /
 *       引用 / 分割线 / 链接 / 图片 / 表格 / XSS 防护 / 非贪婪边界 /
 *       空输入 / 纯文本
 */
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  // ── 标题 ──
  it('converts H1-H6', () => {
    const md = '# 一级\n## 二级\n### 三级\n#### 四级\n##### 五级\n###### 六级'
    const html = renderMarkdown(md)
    expect(html).toContain('<h1>一级</h1>')
    expect(html).toContain('<h2>二级</h2>')
    expect(html).toContain('<h6>六级</h6>')
  })

  // ── 加粗 & 斜体 ──
  it('converts bold with non-greedy matching', () => {
    // 非贪婪：**a** and **b** 应该分成两个 <strong>，不会吃成一整段
    const html = renderMarkdown('**加粗A** 和 **加粗B**')
    expect(html).toContain('<strong>加粗A</strong>')
    expect(html).toContain('<strong>加粗B</strong>')
    // 不应该出现中间被吃掉的情况
    expect(html).not.toContain('<strong>加粗A** 和 **加粗B</strong>')
  })

  it('converts italic', () => {
    const html = renderMarkdown('这是 *斜体* 文字')
    expect(html).toContain('<em>斜体</em>')
  })

  // ── 行内代码 ──
  it('converts inline code', () => {
    const html = renderMarkdown('调用 `Promise.all()` 方法')
    expect(html).toContain('<code>Promise.all()</code>')
  })

  // ── 代码块 ──
  it('converts fenced code blocks', () => {
    const md = '```\nconst x = 1\nconsole.log(x)\n```'
    const html = renderMarkdown(md)
    expect(html).toContain('<pre><code>')
    expect(html).toContain('const x = 1')
  })

  // ── 无序列表 ──
  it('converts unordered lists', () => {
    const md = '- 第一项\n- 第二项\n- 第三项'
    const html = renderMarkdown(md)
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>第一项</li>')
    expect(html).toContain('<li>第二项</li>')
    expect(html).toContain('<li>第三项</li>')
    expect(html).toContain('</ul>')
  })

  // ── 有序列表 ──
  it('converts ordered lists', () => {
    const md = '1. 第一步\n2. 第二步\n3. 第三步'
    const html = renderMarkdown(md)
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>第一步</li>')
    expect(html).toContain('<li>第三步</li>')
    expect(html).toContain('</ol>')
  })

  it('preserves ordered-list numbers when blank lines split the list', () => {
    const html = renderMarkdown('1. 第一项\n\n2. 第二项\n\n3. 第三项')
    expect(html).toContain('<ol>\n<li>第一项</li>\n</ol>')
    expect(html).toContain('<ol start="2">\n<li>第二项</li>\n</ol>')
    expect(html).toContain('<ol start="3">\n<li>第三项</li>\n</ol>')
  })

  // ── 引用 ──
  it('converts blockquotes', () => {
    const html = renderMarkdown('> 这是一段引用')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('这是一段引用')
    expect(html).toContain('</blockquote>')
  })

  // ── 分割线 ──
  it('converts horizontal rules', () => {
    expect(renderMarkdown('---')).toContain('<hr')
    expect(renderMarkdown('***')).toContain('<hr')
  })

  // ── 链接 ──
  it('converts links', () => {
    const html = renderMarkdown('[点击这里](https://example.com)')
    expect(html).toContain('<a href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('>点击这里</a>')
  })

  it('blocks javascript: URLs to prevent XSS', () => {
    const html = renderMarkdown('[恶意链接](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<a href="javascript')
  })

  // ── 图片 ──
  it('converts images', () => {
    const html = renderMarkdown('![架构图](./arch.png)')
    expect(html).toContain('<img')
    expect(html).toContain('src="./arch.png"')
    expect(html).toContain('alt="架构图"')
  })

  // ── 表格 ──
  it('converts tables', () => {
    const md = [
      '| 指标 | 数值 | 说明 |',
      '|------|------|------|',
      '| 节点 | 350  | 个   |',
      '| 关系 | 470  | 条   |',
    ].join('\n')
    const html = renderMarkdown(md)
    expect(html).toContain('<table>')
    expect(html).toContain('<thead>')
    expect(html).toContain('<th>指标</th>')
    expect(html).toContain('<td>350</td>')
    expect(html).toContain('<td>470</td>')
    expect(html).toContain('</table>')
  })

  // ── XSS 防护 ──
  it('escapes HTML tags to prevent XSS', () => {
    const html = renderMarkdown('<script>alert("xss")</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  // ── 边界 ──
  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('')
  })

  it('preserves plain text without markdown syntax', () => {
    const text = '这是一段没有任何特殊语法的普通文本。'
    expect(renderMarkdown(text)).toContain(text)
  })
})
