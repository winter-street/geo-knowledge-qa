<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const collapsed = ref(false)

const navItems = [
  { path: '/admin/console', label: '知识库管理', icon: 'settings' },
  { path: '/admin/qa', label: '智能问答', icon: 'chat' },
  { path: '/admin/map', label: '地图交互', icon: 'map' },
  { path: '/admin/graph', label: '知识图谱', icon: 'graph' },
]

const pageTitle = computed(() => (route.meta?.title as string) || '管理后台')

function navigate(path: string) {
  router.push(path)
}

function toggleSidebar() {
  collapsed.value = !collapsed.value
}

function handleLogout() {
  userStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="app-layout">
    <aside class="sidebar" :class="{ collapsed }">
      <div class="logo" @click="navigate('/admin')">
        <span class="logo-text">GK</span>
      </div>
      <div v-if="!collapsed" class="workspace-tag">管理控制台</div>
      <nav class="nav">
        <button
          v-for="item in navItems"
          :key="item.path"
          class="nav-btn"
          :class="{ active: route.path === item.path }"
          @click="navigate(item.path)"
        >
          <svg v-if="item.icon === 'chat'" class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 4h14a1 1 0 011 1v8a1 1 0 01-1 1H7l-4 3V5a1 1 0 011-1z" />
          </svg>
          <svg v-else-if="item.icon === 'map'" class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="10" cy="8" r="3" />
            <path d="M10 18s-6-5.5-6-10a6 6 0 1112 0c0 4.5-6 10-6 10z" />
          </svg>
          <svg v-else-if="item.icon === 'graph'" class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="5" cy="5" r="2.5" />
            <circle cx="15" cy="5" r="2.5" />
            <circle cx="10" cy="15" r="2.5" />
            <path d="M7 6.5l3 6M13 6.5l-3 6" />
          </svg>
          <svg v-else-if="item.icon === 'settings'" class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 5h14M3 10h14M3 15h14" />
            <circle cx="7" cy="5" r="1.5" fill="currentColor" />
            <circle cx="13" cy="10" r="1.5" fill="currentColor" />
            <circle cx="9" cy="15" r="1.5" fill="currentColor" />
          </svg>
          <span v-if="!collapsed" class="nav-label">{{ item.label }}</span>
          <span v-if="collapsed" class="nav-tip">{{ item.label }}</span>
        </button>
      </nav>
      <div class="bottom-btns">
        <button class="nav-btn" @click="toggleSidebar">
          <svg class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path v-if="collapsed" d="M4 6h12M4 10h12M4 14h12" />
            <path v-else d="M5 5l10 10M15 5L5 15" />
          </svg>
          <span v-if="!collapsed" class="nav-label">{{ collapsed ? '展开' : '收起' }}</span>
          <span v-if="collapsed" class="nav-tip">展开</span>
        </button>
        <button class="nav-btn logout" @click="handleLogout">
          <svg class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 3H4a1 1 0 00-1 1v12a1 1 0 001 1h3M11 14l4-4-4-4M15 10H7" />
          </svg>
          <span v-if="!collapsed" class="nav-label">退出</span>
          <span v-if="collapsed" class="nav-tip">退出登录</span>
        </button>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <span class="page-title">{{ pageTitle }}</span>
        <div class="user-box">
          <span class="role-badge admin">管理员</span>
          <span class="username">{{ userStore.username || 'admin' }}</span>
        </div>
      </header>
      <section class="content">
        <router-view />
      </section>
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ---- Sidebar ---- */
.sidebar {
  width: 200px;
  background: var(--color-sidebar);
  border-right: 1px solid var(--color-ink-100);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 0 12px;
  gap: 4px;
  flex-shrink: 0;
  transition: width .25s cubic-bezier(.4,0,.2,1);
}

.sidebar.collapsed {
  width: 56px;
}

.logo {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--color-ink-900);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin-bottom: 12px;
  flex-shrink: 0;
  transition: opacity .15s;
}

.logo:hover { opacity: 0.8; }

.logo-text {
  color: var(--color-bg);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.5px;
  font-family: var(--font-display);
}

.workspace-tag {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--color-primary);
  background: var(--color-primary-ghost);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
}

/* Nav */
.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  width: 100%;
  padding: 0 8px;
}

.nav-btn {
  width: 100%;
  height: 38px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  cursor: pointer;
  transition: all .15s;
  position: relative;
  border: none;
  background: transparent;
  color: var(--color-ink-500);
  font-family: inherit;
}

.nav-btn:hover {
  background: var(--color-sidebar-hover);
  color: var(--color-ink-700);
}

.nav-btn.active {
  background: var(--color-sidebar-active);
  color: var(--color-primary);
  font-weight: 500;
}

.nav-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.nav-label {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-btn .nav-tip {
  position: absolute;
  left: 50px;
  background: var(--color-ink-900);
  color: #fff;
  padding: 4px 10px;
  border-radius: var(--radius-md);
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity .15s;
  z-index: 10;
}

.nav-btn:hover .nav-tip {
  opacity: 1;
}

.bottom-btns {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 0 8px;
}

.nav-btn.logout:hover {
  background: var(--color-danger-light);
  color: var(--color-danger);
}

/* ---- Main ---- */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.topbar {
  height: 52px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-ink-100);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  flex-shrink: 0;
}

.page-title {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--color-ink-900);
  letter-spacing: -0.01em;
}

.user-box {
  display: flex;
  align-items: center;
  gap: 10px;
}

.role-badge {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
}

.role-badge.admin {
  color: var(--color-danger);
  background: var(--color-danger-light);
}

.username {
  font-size: 13px;
  color: var(--color-ink-700);
  font-weight: 500;
}

.content {
  flex: 1;
  overflow: hidden;
}
</style>
