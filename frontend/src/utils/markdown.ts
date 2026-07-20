/**
 * 轻量 Markdown → HTML 转换（零依赖）。
 *
 * LLM 返回 Markdown（## 标题、**加粗**、- 列表、`代码` 等），
 * ChatMessage.vue 用 v-html 渲染前必须先转换。
 *
 * 覆盖语法：标题、加粗、斜体、行内代码、代码块、无序/有序列表、
 * 引用、分割线、链接、图片、表格。
 *
 * 安全：先全文 HTML 转义，杜绝 XSS，再逐步还原 Markdown 记号。
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 行内元素：加粗、斜体、行内代码、链接、图片。输入已 HTML 转义。 */
function renderInline(text: string): string {
  return (
    text
      // 图片 ![alt](url) —— 放在链接之前，避免被链接正则误匹配
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" />')
      // 链接 [text](url) —— 仅允许 http/https，其余协议丢弃 URL 仅保留文字
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
      )
      // 非 http/https 的"链接"（如 javascript:）——丢掉 URL，只保留文字
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // 行内代码 `code`
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // 加粗 **text** —— 非贪婪，防止连写时吃错边界
      .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
      // 斜体 *text* —— 放在加粗之后，避免 ** 被误拆
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  )
}

export function renderMarkdown(md: string): string {
  if (!md) return ''

  const escaped = escapeHtml(md)
  const lines = escaped.split('\n')
  const html: string[] = []

  let inCodeBlock = false
  let codeBuffer: string[] = []
  let listType: 'ul' | 'ol' | null = null

  /** 关闭当前列表（如果有） */
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`)
      listType = null
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    // 代码块 ```
    const fenceMatch = line.trim().match(/^```(.*)$/)
    if (fenceMatch) {
      if (inCodeBlock) {
        html.push(`<pre><code>${codeBuffer.join('\n')}</code></pre>`)
        codeBuffer = []
        inCodeBlock = false
      } else {
        closeList()
        inCodeBlock = true
      }
      continue
    }
    if (inCodeBlock) {
      codeBuffer.push(line)
      continue
    }

    // 空行 → 结束列表
    if (line.trim() === '') {
      closeList()
      continue
    }

    // 表格 —— 前看一行判断表头
    if (line.startsWith('|') && line.endsWith('|')) {
      closeList()
      const cells = line.split('|').filter(c => c !== '').map(c => c.trim())
      const isHeaderSep = cells.every(c => /^[-:]+$/.test(c))
      if (isHeaderSep) continue // 跳过分隔行

      // 如果下一行是分隔符 → 当前行是表头
      const nextLine = (i + 1 < lines.length ? lines[i + 1] : '') ?? ''
      const nextCells = nextLine.startsWith('|') && nextLine.endsWith('|')
        ? nextLine.split('|').filter(c => c !== '').map(c => c.trim())
        : []
      const nextIsSep = nextCells.length > 0 && nextCells.every(c => /^[-:]+$/.test(c))

      if (nextIsSep) {
        // 表头行
        if (!html.includes('<table>')) html.push('<table>')
        html.push('<thead><tr>')
        for (const cell of cells) {
          html.push(`<th>${renderInline(cell)}</th>`)
        }
        html.push('</tr></thead><tbody>')
        i++ // 跳过分隔行
      } else {
        // 数据行
        if (!html.includes('<table>') && html.includes('<thead>')) {
          // table 已在 thead 前创建
        } else if (!html.includes('<table>')) {
          html.push('<table><tbody>')
        }
        html.push('<tr>')
        for (const cell of cells) {
          html.push(`<td>${renderInline(cell)}</td>`)
        }
        html.push('</tr>')
      }
      continue
    }
    // 表格结束后闭合 <tbody> + <table>（由下一行非表格行触发）
    // 简化处理：用闭合信号
    if (html.length > 0 && html[html.length - 1] === '<tbody>') {
      // 上一段表格已经开始但还没有行数据被关闭的场景由后面处理
    }

    // 分割线 --- / ***
    if (/^\s*([-*])\1\1+\s*$/.test(line)) {
      closeList()
      html.push('<hr />')
      continue
    }

    // 标题 # ~ ######
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeList()
      const level = (heading[1] ?? '').length
      html.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`)
      continue
    }

    // 引用 >（全文已 HTML 转义，> 此时是 &gt;）
    const quote = line.match(/^&gt;\s?(.*)$/)
    if (quote) {
      closeList()
      html.push(`<blockquote>${renderInline(quote[1] ?? '')}</blockquote>`)
      continue
    }

    // 无序列表 - / * / +
    const ul = line.match(/^\s*[-*+]\s+(.*)$/)
    if (ul) {
      if (listType !== 'ul') {
        closeList()
        html.push('<ul>')
        listType = 'ul'
      }
      html.push(`<li>${renderInline(ul[1] ?? '')}</li>`)
      continue
    }

    // 有序列表 1. / 2.
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

    // 普通段落
    closeList()
    html.push(`<p>${renderInline(line)}</p>`)
  }

  // 收尾：未闭合的代码块和列表，以及未闭合的表格
  if (inCodeBlock) html.push(`<pre><code>${codeBuffer.join('\n')}</code></pre>`)
  closeList()

  const result = html.join('\n')
  // 闭合未封口的表格标签
  const openTable = (result.match(/<table>/g) || []).length
  const closeTable = (result.match(/<\/table>/g) || []).length
  const openTbody = (result.match(/<tbody>/g) || []).length
  const closeTbody = (result.match(/<\/tbody>/g) || []).length

  let final = result
  for (let i = 0; i < openTbody - closeTbody; i++) final += '</tbody>'
  for (let i = 0; i < openTable - closeTable; i++) final += '</table>'

  return final
}
