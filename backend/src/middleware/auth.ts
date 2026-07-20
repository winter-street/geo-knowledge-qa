import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'
import { config } from '../config.js'

/** JWT 载荷 */
export interface JwtPayload {
  userId: string
  username: string
  role: 'user' | 'admin'
}

/** 签发 JWT Token */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: '24h',
  })
}

/** 验证 JWT Token */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload
}

/** Express 鉴权中间件 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // OPTIONS 预检请求直接放行（CORS 需要）
  if (req.method === 'OPTIONS') {
    next()
    return
  }

  // 公开路由跳过鉴权
  const publicPaths = ['/api/auth/login', '/api/health']
  if (publicPaths.includes(req.path)) {
    next()
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: '未登录，请先登录' })
    return
  }

  const token = authHeader.slice(7)
  try {
    const payload = verifyToken(token)
    // 将用户信息注入 request
    ;(req as any).user = payload
    next()
  } catch {
    res.status(401).json({ error: '登录已过期，请重新登录' })
  }
}

/** 管理员鉴权中间件 */
export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user as JwtPayload | undefined
  if (!user || user.role !== 'admin') {
    res.status(403).json({ error: '权限不足，仅管理员可操作' })
    return
  }
  next()
}
