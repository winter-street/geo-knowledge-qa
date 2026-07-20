import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type Role = 'user' | 'admin'

const TOKEN_KEY = 'token'
const ROLE_KEY = 'role'
const NAME_KEY = 'username'

export const useUserStore = defineStore('user', () => {
  // 从 localStorage 恢复整套会话，保证刷新后身份不丢失。
  // 原实现只持久化了 token，role/username 每次刷新都被重置成 'admin'，
  // 会导致普通用户刷新后错误进入管理员界面 —— 这是角色区分必须修复的核心 bug。
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
  const username = ref<string>(localStorage.getItem(NAME_KEY) || '')
  const role = ref<Role>((localStorage.getItem(ROLE_KEY) as Role) || 'user')

  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => role.value === 'admin')

  /** 登录成功后写入整套会话信息并持久化 */
  function setSession(session: { token: string; username: string; role: Role }) {
    token.value = session.token
    username.value = session.username
    role.value = session.role
    localStorage.setItem(TOKEN_KEY, session.token)
    localStorage.setItem(NAME_KEY, session.username)
    localStorage.setItem(ROLE_KEY, session.role)
  }

  /** 当前角色对应的首页路径（普通用户 → /user，管理员 → /admin） */
  function homePath(): string {
    return role.value === 'admin' ? '/admin' : '/user'
  }

  function logout() {
    token.value = null
    username.value = ''
    role.value = 'user'
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(NAME_KEY)
    localStorage.removeItem(ROLE_KEY)
  }

  return { token, username, role, isLoggedIn, isAdmin, setSession, homePath, logout }
})
