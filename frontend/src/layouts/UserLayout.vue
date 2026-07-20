<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const navItems = [
  { path: '/user/qa', label: '智能问答', icon: 'chat' },
  { path: '/user/map', label: '地图交互', icon: 'map' },
  { path: '/user/graph', label: '知识图谱', icon: 'graph' },
]

const activePath = computed(() => route.path)

function navigate(path: string) {
  router.push(path)
}

function handleLogout() {
  userStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="user-shell">
    <header class="topbar">
      <div class="brand" @click="navigate('/user/qa')">
        <span class="brand-mark">GK</span>
        <div class="brand-text">
          <span class="brand-name">地质找矿智能问答</span>
          <span class="brand-sub">Geo-Knowledge Q&amp;A</span>
        </div>
      </div>

      <nav class="topnav">
        <button
          v-for="item in navItems"
          :key="item.path"
          class="nav-tab"
          :class="{ active: activePath === item.path }"
          @click="navigate(item.path)"
        >
          <svg v-if="item.icon === 'chat'" class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 4h14a1 1 0 011 1v8a1 1 0 01-1 1H7l-4 3V5a1 1 0 011-1z" />
          </svg>
          <svg v-else-if="item.icon === 'map'" class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="10" cy="8" r="3" />
            <path d="M10 18s-6-5.5-6-10a6 6 0 1112 0c0 4.5-6 10-6 10z" />
          </svg>
          <svg v-else class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="5" cy="5" r="2.5" />
            <circle cx="15" cy="5" r="2.5" />
            <circle cx="10" cy="15" r="2.5" />
            <path d="M7 6.5l3 6M13 6.5l-3 6" />
          </svg>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="user-box">
        <span class="role-badge">普通用户</span>
        <span class="username">{{ userStore.username || '访客' }}</span>
        <button class="logout-btn" title="退出登录" @click="handleLogout">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 3H4a1 1 0 00-1 1v12a1 1 0 001 1h3M11 14l4-4-4-4M15 10H7" />
          </svg>
        </button>
      </div>
    </header>

    <section class="content">
      <router-view />
    </section>
  </div>
</template>

<style scoped>
.user-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--color-bg);
}

/* ---- Top bar ---- */
.topbar {
  height: 60px;
  flex-shrink: 0;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-ink-100);
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 0 32px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  background: var(--color-ink-900);
  color: var(--color-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.5px;
  font-family: var(--font-display);
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.brand-name {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
  color: var(--color-ink-900);
  letter-spacing: -0.01em;
}

.brand-sub {
  font-size: 10px;
  color: var(--color-ink-300);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* ---- Horizontal nav ---- */
.topnav {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
}

.nav-tab {
  height: 36px;
  padding: 0 16px;
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-family: inherit;
  color: var(--color-ink-500);
  cursor: pointer;
  transition: all .15s;
}

.nav-tab:hover {
  background: var(--color-bg-subtle);
  color: var(--color-ink-900);
}

.nav-tab.active {
  background: var(--color-primary-ghost);
  color: var(--color-primary);
  font-weight: 500;
}

.nav-icon {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}

/* ---- User box ---- */
.user-box {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.role-badge {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  color: var(--color-primary);
  background: var(--color-primary-ghost);
}

.username {
  font-size: 13px;
  color: var(--color-ink-700);
  font-weight: 500;
}

.logout-btn {
  width: 34px;
  height: 34px;
  border: 1px solid var(--color-ink-100);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-ink-500);
  transition: all .15s;
}

.logout-btn svg {
  width: 16px;
  height: 16px;
}

.logout-btn:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
  background: var(--color-danger-light);
}

/* ---- Content ---- */
.content {
  flex: 1;
  overflow: hidden;
}
</style>
