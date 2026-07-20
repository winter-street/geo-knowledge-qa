<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore, type Role } from '@/stores/user'
import { login } from '@/api/auth'

const router = useRouter()
const userStore = useUserStore()

// 演示账号（与后端 DEMO_USERS 对应）
const DEMO: Record<Role, { username: string; password: string }> = {
  user: { username: 'user', password: 'user123' },
  admin: { username: 'admin', password: 'admin123' },
}

const roleLabels: Record<Role, string> = {
  user: '普通用户',
  admin: '管理人员',
}

const selectedRole = ref<Role>('user')
const username = ref(DEMO.user.username)
const password = ref(DEMO.user.password)
const loading = ref(false)
const error = ref('')

// 切换身份时，自动填入对应演示账号，方便快速登录验证两套界面
function selectRole(role: Role) {
  if (selectedRole.value === role) return
  selectedRole.value = role
  username.value = DEMO[role].username
  password.value = DEMO[role].password
  error.value = ''
}

async function handleLogin() {
  if (!username.value.trim() || !password.value.trim()) {
    error.value = '请输入账号和密码'
    return
  }
  error.value = ''
  loading.value = true
  try {
    // 把所选身份传入，仅在「离线开发兜底」时用于返回对应角色；真实后端只校验账号密码
    const res = await login(username.value.trim(), password.value, selectedRole.value)

    // 以后端返回的 role 为准，并校验其与所选身份是否一致，防止用错账号进错界面
    if (res.role !== selectedRole.value) {
      error.value = `该账号的身份是「${roleLabels[res.role]}」，无法以「${roleLabels[selectedRole.value]}」登录`
      return
    }

    userStore.setSession(res)
    router.push(userStore.homePath())
  } catch {
    error.value = '登录失败，请检查账号密码后重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-rule" />
      <h1>Geo-Knowledge Q&amp;A</h1>
      <p class="subtitle">地质找矿智能问答系统</p>

      <!-- 身份选择 -->
      <div class="role-tabs">
        <button
          type="button"
          class="role-tab"
          :class="{ active: selectedRole === 'user' }"
          @click="selectRole('user')"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="10" cy="6" r="3" /><path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          </svg>
          普通用户
        </button>
        <button
          type="button"
          class="role-tab"
          :class="{ active: selectedRole === 'admin' }"
          @click="selectRole('admin')"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 2l6 3v4c0 4-2.7 7-6 9-3.3-2-6-5-6-9V5l6-3z" />
          </svg>
          管理人员
        </button>
      </div>

      <form class="form" @submit.prevent="handleLogin">
        <div class="field">
          <label>账号</label>
          <input v-model="username" placeholder="请输入账号" autocomplete="username" />
        </div>
        <div class="field">
          <label>密码</label>
          <input v-model="password" type="password" placeholder="请输入密码" autocomplete="current-password" />
        </div>
        <div v-if="error" class="error">{{ error }}</div>
        <button class="login-btn" :disabled="loading" type="submit">
          {{ loading ? '登录中...' : `以${roleLabels[selectedRole]}身份登录` }}
        </button>
      </form>

      <p class="demo-hint">
        演示账号：{{ DEMO[selectedRole].username }} / {{ DEMO[selectedRole].password }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
}

.login-card {
  width: 360px;
  padding: 48px 0;
  text-align: center;
}

.login-rule {
  width: 48px;
  height: 1px;
  background: var(--color-primary);
  margin: 0 auto 24px;
}

h1 {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
  color: var(--color-ink-900);
  letter-spacing: -0.02em;
  margin-bottom: 6px;
}

.subtitle {
  font-size: 13px;
  color: var(--color-ink-500);
  margin-bottom: 28px;
  letter-spacing: 0.02em;
}

/* 身份选择 */
.role-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 28px;
}

.role-tab {
  flex: 1;
  height: 44px;
  border: 1px solid var(--color-ink-100);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 14px;
  font-family: inherit;
  color: var(--color-ink-500);
  cursor: pointer;
  transition: all .15s;
}

.role-tab svg {
  width: 17px;
  height: 17px;
}

.role-tab:hover {
  border-color: var(--color-ink-300);
  color: var(--color-ink-700);
}

.role-tab.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-ghost);
  font-weight: 500;
}

.form {
  text-align: left;
}

.field {
  margin-bottom: 20px;
}

.field label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-ink-500);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 6px;
}

.field input {
  width: 100%;
  padding: 10px 0;
  border: none;
  border-bottom: 1px solid var(--color-ink-100);
  font-size: 15px;
  font-family: var(--font-body);
  background: transparent;
  color: var(--color-ink-900);
  transition: border-color 0.2s;
  outline: none;
}

.field input:focus {
  border-bottom-color: var(--color-primary);
}

.field input::placeholder {
  color: var(--color-ink-300);
  font-size: 14px;
}

.error {
  font-size: 13px;
  color: var(--color-danger);
  text-align: center;
  padding: 8px 0;
}

.login-btn {
  width: 100%;
  padding: 12px;
  background: var(--color-ink-900);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 12px;
  font-family: var(--font-body);
  letter-spacing: 0.06em;
  transition: background 0.2s;
}

.login-btn:hover:not(:disabled) {
  background: var(--color-ink-700);
}

.login-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.demo-hint {
  margin-top: 20px;
  font-size: 12px;
  color: var(--color-ink-300);
  letter-spacing: 0.02em;
}
</style>
