import { createRouter, createWebHashHistory, type RouteLocationNormalized } from 'vue-router'

type Role = 'user' | 'admin'

function currentToken(): string | null {
  return localStorage.getItem('token')
}

function currentRole(): Role | null {
  const r = localStorage.getItem('role')
  return r === 'admin' || r === 'user' ? r : null
}

/** 角色对应的首页 */
function homeFor(role: Role | null): string {
  return role === 'admin' ? '/admin' : '/user'
}

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: () => (currentToken() ? homeFor(currentRole()) : '/login'),
    },
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/LoginView.vue'),
      meta: { title: '登录', public: true },
    },

    // ================= 普通用户界面 =================
    {
      path: '/user',
      component: () => import('@/layouts/UserLayout.vue'),
      meta: { roles: ['user'] as Role[] },
      children: [
        { path: '', redirect: '/user/qa' },
        { path: 'qa', name: 'UserQa', component: () => import('@/views/QaView.vue'), meta: { title: '智能问答' } },
        { path: 'map', name: 'UserMap', component: () => import('@/views/MapView.vue'), meta: { title: '地图交互' } },
        { path: 'graph', name: 'UserGraph', component: () => import('@/views/GraphView.vue'), meta: { title: '知识图谱' } },
      ],
    },

    // ================= 管理员界面 =================
    {
      path: '/admin',
      component: () => import('@/layouts/AdminLayout.vue'),
      meta: { roles: ['admin'] as Role[] },
      children: [
        { path: '', redirect: '/admin/console' },
        { path: 'console', name: 'AdminConsole', component: () => import('@/views/AdminView.vue'), meta: { title: '知识库管理' } },
        { path: 'qa', name: 'AdminQa', component: () => import('@/views/QaView.vue'), meta: { title: '智能问答' } },
        { path: 'map', name: 'AdminMap', component: () => import('@/views/MapView.vue'), meta: { title: '地图交互' } },
        { path: 'graph', name: 'AdminGraph', component: () => import('@/views/GraphView.vue'), meta: { title: '知识图谱' } },
      ],
    },

    // 兜底：未知路径回到根，由根的 redirect 决定去向
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

// 路由守卫：登录态 + 角色双重校验
router.beforeEach((to: RouteLocationNormalized) => {
  const token = currentToken()
  const role = currentRole()

  // 登录页：已登录（且角色有效）则直接进入对应角色首页
  if (to.path === '/login') {
    return token && role ? homeFor(role) : true
  }

  // 其余页面必须登录
  if (!token) {
    return { path: '/login' }
  }

  // 有 token 但缺少有效角色（例如从旧版本升级遗留的登录态）→ 强制重新登录
  if (!role) {
    return { path: '/login' }
  }

  // 角色鉴权：访问不属于自己角色的界面 → 跳回本角色首页
  // （meta.roles 由父级布局路由声明，会合并到子路由的 to.meta 上）
  const allowed = to.meta.roles as Role[] | undefined
  if (allowed && !allowed.includes(role)) {
    return homeFor(role)
  }

  return true
})

export default router
