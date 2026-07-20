import { Router, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import { signToken } from '../middleware/auth.js'

const router = Router()

// 演示账号（中期答辩用，后续替换为数据库）
const DEMO_USERS: { username: string; passwordHash: string; role: 'user' | 'admin' }[] = [
  // 密码 admin123 的 bcrypt hash
  {
    username: 'admin',
    passwordHash: '$2b$10$WSMSTp1vS9hvw/FZYr5CVuQt/MDy5Hu508Cx8X8JJ2N1bQNaaQ8oa',
    role: 'admin',
  },
  // 密码 user123 的 bcrypt hash
  {
    username: 'user',
    passwordHash: '$2b$10$iqJFDjxqdM15n0U2dbG7leybZW251V3HKWQSiMql4FSSbdILZYJuu',
    role: 'user',
  },
]

/**
 * POST /api/auth/login
 */
router.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      res.status(400).json({ error: '用户名和密码不能为空' })
      return
    }

    const user = DEMO_USERS.find((u) => u.username === username)
    if (!user) {
      res.status(401).json({ error: '用户名或密码错误' })
      return
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      res.status(401).json({ error: '用户名或密码错误' })
      return
    }

    const token = signToken({
      userId: user.username,
      username: user.username,
      role: user.role,
    })

    res.json({
      token,
      username: user.username,
      role: user.role,
    })
  } catch (err) {
    console.error('[auth] 登录失败:', err)
    res.status(500).json({ error: '服务内部错误' })
  }
})

export default router
