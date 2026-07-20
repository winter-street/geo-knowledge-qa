import axios from 'axios'
import { ElMessage } from 'element-plus'

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string> }).env

const request = axios.create({
  baseURL: viteEnv?.VITE_API_BASE || '/api',
  timeout: 15000,
})

request.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

request.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      // 令牌失效：清空整套会话，避免残留的 role/username 造成身份错乱
      localStorage.removeItem('token')
      localStorage.removeItem('role')
      localStorage.removeItem('username')
      ElMessage.error('登录已过期，请重新登录')
    } else if (error.response?.status !== 404) {
      // 404 常见于「尚未实现的后端接口」（如 getHistory），静默失败不弹 toast
      ElMessage.error(error.message || '请求失败')
    }
    return Promise.reject(error)
  }
)

export default request
