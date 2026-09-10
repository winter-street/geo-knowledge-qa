# 视觉设计 Token

> 日期：2026-06-29
> 基于：ui-ux-pro-max + frontend-design skill
> 产品：Geo-KG + RAG 智能问答系统

## 设计理念

从 GIS 领域本身提取视觉灵感：地图的蓝绿色系、等高线的层次感、图谱节点的连线、地理空间的网格感。拒绝默认 Element Plus 蓝。

**签名元素：** 等高线纹理 + 节点连线装饰，用在侧边栏背景和页面过渡中。

## 色彩 Token

### 原始色板（Primitive）

| Token | Hex | 说明 |
|-------|-----|------|
| `--color-ink-900` | #0F172A | 最深文字 |
| `--color-ink-700` | #334155 | 主要文字 |
| `--color-ink-500` | #64748B | 次要文字 |
| `--color-ink-300` | #CBD5E1 | 占位文字 |
| `--color-ink-100` | #F1F5F9 | 浅色边框 |

### 语义色板（Semantic）

| Token | Hex | 用途 |
|-------|-----|------|
| `--color-primary` | #0E7490 | 主色（深青，来自深海/等高线） |
| `--color-primary-light` | #22D3EE | 主色亮色变体 |
| `--color-primary-dark` | #155E75 | 主色暗色变体 |
| `--color-secondary` | #059669 | 辅助色（翠绿，来自地图植被） |
| `--color-accent` | #D97706 | 强调色（琥珀，来自地图标注） |
| `--color-danger` | #DC2626 | 错误/删除 |
| `--color-surface` | #FFFFFF | 卡片背景 |
| `--color-bg` | #F8FAFC | 页面背景 |
| `--color-sidebar` | #0F172A | 侧边栏背景（深墨） |
| `--color-sidebar-active` | #0E7490 | 侧边栏选中项 |

### 组件色板（Component）

| Token | 值 | 用途 |
|-------|-----|------|
| `--button-bg` | `var(--color-primary)` | 按钮背景 |
| `--button-hover` | `var(--color-primary-dark)` | 按钮悬停 |
| `--card-bg` | `var(--color-surface)` | 卡片背景 |
| `--card-border` | `var(--color-ink-100)` | 卡片边框 |
| `--card-shadow` | 0 1px 3px rgba(15,23,42,.06) | 卡片阴影 |
| `--input-border` | `var(--color-ink-100)` | 输入框边框 |
| `--input-focus` | `var(--color-primary)` | 输入框聚焦 |

## 字体 Token

| 角色 | 字体 | 回退栈 |
|------|------|--------|
| 正文 | Inter | -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif |
| 数据/代码 | JetBrains Mono | "IBM Plex Mono", ui-monospace, monospace |
| 中文正文 | "PingFang SC" / "Microsoft YaHei" | 系统默认 |

### 字号层级

| Token | 大小 | 行高 | 用途 |
|-------|------|------|------|
| `--text-hero` | 36px | 1.1 | 页面大标题 |
| `--text-h1` | 24px | 1.3 | 区块标题 |
| `--text-h2` | 18px | 1.4 | 卡片标题 |
| `--text-body` | 14px | 1.6 | 正文 |
| `--text-caption` | 12px | 1.5 | 辅助文字 |
| `--text-data` | 14px | 1.4 | 数据/代码（等宽） |

## 间距 Token

基于 4px 网格：

| Token | 值 | 用途 |
|-------|-----|------|
| `--space-1` | 4px | 紧凑间距 |
| `--space-2` | 8px | 元素内间距 |
| `--space-3` | 12px | 小组件间距 |
| `--space-4` | 16px | 标准间距 |
| `--space-6` | 24px | 区块间距 |
| `--space-8` | 32px | 大区块间距 |
| `--space-12` | 48px | 页面级间距 |

## 圆角 Token

| Token | 值 | 用途 |
|-------|-----|------|
| `--radius-sm` | 4px | 小元素（标签、badge） |
| `--radius-md` | 8px | 卡片、输入框 |
| `--radius-lg` | 12px | 弹窗、大卡片 |
| `--radius-full` | 9999px | 圆形（头像、状态点） |

## 阴影 Token

| Token | 值 | 用途 |
|-------|-----|------|
| `--shadow-sm` | 0 1px 3px rgba(15,23,42,.06) | 卡片默认 |
| `--shadow-md` | 0 4px 12px rgba(15,23,42,.08) | 卡片悬停 |
| `--shadow-lg` | 0 8px 24px rgba(15,23,42,.12) | 弹窗/浮层 |

## 签名元素

1. **等高线纹理**：侧边栏背景叠加半透明等高线 SVG 纹理，暗示地理空间主题
2. **节点连线装饰**：页面标题下方用细线 + 小圆点装饰，呼应知识图谱
3. **数据高亮色**：关键数字用 `--color-accent`（琥珀色）高亮，如切片数、节点数

## 与 Element Plus 的关系

Element Plus 通过 CSS 变量覆盖默认主题：

```css
:root {
  --el-color-primary: var(--color-primary);
  --el-color-primary-light-3: var(--color-primary-light);
  --el-color-primary-dark-2: var(--color-primary-dark);
  --el-bg-color: var(--color-bg);
  --el-text-color-primary: var(--color-ink-900);
  --el-text-color-regular: var(--color-ink-700);
  --el-text-color-secondary: var(--color-ink-500);
  --el-border-color: var(--color-ink-100);
  --el-border-radius-base: var(--radius-md);
}
```
