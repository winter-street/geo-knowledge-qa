/**
 * 问答测试脚本（Node.js 原生 HTTP，保证 UTF-8 编码正确）
 *
 * 用法：node test-qa.mjs "你的问题"
 * 示例：node test-qa.mjs "养老院属于什么用地类型？"
 *      node test-qa.mjs "三区三线是什么" --stream
 */

import http from 'node:http'

const question = process.argv[2] || '养老院属于什么用地类型？'
const useStream = process.argv.includes('--stream')

/** 登录获取 token */
function login() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ username: 'admin', password: 'admin123' })
    const req = http.request(
      {
        hostname: 'localhost', port: 3000,
        path: '/api/auth/login', method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve(JSON.parse(body).token))
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

/** 发送问答请求 */
function ask(token, stream) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ question, stream })
    const req = http.request(
      {
        hostname: 'localhost', port: 3000,
        path: '/api/qa/ask', method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(data),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        if (stream) {
          // SSE 模式
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
          console.log('📋 问题:', question)
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
          res.on('data', (chunk) => {
            const lines = chunk.toString().split('\n')
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              try {
                const event = JSON.parse(line.slice(6))
                if (event.type === 'chunk') process.stdout.write(event.content)
                if (event.type === 'meta') console.log(`[检索: RAG ${event.ragCount}条, KG ${event.kgCount}条]`)
                if (event.type === 'done') {
                  if (event.sources?.length) {
                    console.log('\n\n📚 参考来源:')
                    event.sources.forEach((s, i) => console.log(`  [${i + 1}] 《${s.docTitle}》第${s.page}页`))
                  }
                  console.log('')
                }
              } catch {}
            }
          })
          res.on('end', resolve)
        } else {
          // 普通模式
          let body = ''
          res.on('data', (c) => (body += c))
          res.on('end', () => {
            const result = JSON.parse(body)
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            console.log('📋 问题:', question)
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            if (result.answer) console.log(result.answer)
            if (result.sources?.length) {
              console.log('\n📚 参考来源:')
              result.sources.forEach((s, i) => console.log(`  [${i + 1}] 《${s.docTitle}》第${s.page}页`))
            }
            if (result.kgContext?.length) {
              console.log('\n🔗 知识图谱:')
              result.kgContext.forEach((p) => console.log(`  ${p.from} —[${p.relation}]→ ${p.to}`))
            }
            console.log('')
            resolve()
          })
        }
      }
    )
    req.on('error', (err) => {
      console.error('请求失败:', err.message)
      resolve()
    })
    req.write(data)
    req.end()
  })
}

const token = await login()
await ask(token, useStream)
