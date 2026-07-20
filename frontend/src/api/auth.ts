import axios from 'axios'
import request from './request'

export interface LoginResponse {
  token: string
  username: string
  role: 'user' | 'admin'
}

/**
 * 登录。
 *
 * 正常流程：POST /auth/login → { token, username, role }（role 由后端按账号判定，为权威来源）。
 *
 * intendedRole：登录页所选身份，仅用于「离线开发兜底」时返回对应角色，
 * 以便前端脱离后端也能分别验证「普通用户 / 管理员」两套界面；真实后端请求只发送账号密码。
 *
 * 关于开发兜底：仅当「开发环境」且「后端根本没起（网络层失败、拿不到 HTTP 响应）」时才回退。
 * 生产环境，或后端明确返回 4xx/5xx（例如账号密码错误）时一律抛出真实错误，
 * 交由上层（LoginView）提示，绝不伪造登录态或越权角色。
 */
export async function login(
  username: string,
  password: string,
  intendedRole: 'user' | 'admin' = 'user',
): Promise<LoginResponse> {
  try {
    // 第二个泛型是响应拦截器 unwrap（return response.data）之后的真实返回类型，
    // 显式声明后 request.post 才会返回 Promise<LoginResponse> 而非 AxiosResponse。
    return await request.post<unknown, LoginResponse>('/auth/login', { username, password })
  } catch (err) {
    // response 为空 = 没收到任何 HTTP 响应 = 网络层失败（后端未启动 / 断网 / 跨域被拦）
    const backendUnavailable = axios.isAxiosError(err) && !err.response

    if (import.meta.env.DEV && backendUnavailable) {
      console.warn('[auth] 后端不可用，已回退到本地开发登录（仅开发环境生效）')
      return {
        token: `dev-token-${Date.now()}`,
        username: username.trim() || intendedRole,
        role: intendedRole,
      }
    }

    // 其余情况（生产环境，或后端返回了明确的错误响应）——抛出真实错误
    throw err
  }
}
