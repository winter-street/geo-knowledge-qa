# 技术栈速查

## 三层概览

| 层 | 语言 | 框架/库 | 端口 |
|----|------|---------|------|
| 前端 | TypeScript | Vue 3 + Vite + Pinia + Element Plus | :5173 |
| 后端 | TypeScript | Node.js + Express + better-sqlite3 + neo4j-driver | :3000 |
| 预处理 | Python 3.13 | pdfplumber + jieba + scikit-learn + neo4j | 离线脚本 |

## 外部服务

| 服务 | 版本 | 端口 | 用途 |
|------|------|------|------|
| Neo4j Community | 5.26.4 | :7474 (Browser) / :7687 (Bolt) | 知识图谱存储与可视化 |
| DeepSeek API | V4 Flash | HTTPS | LLM 问答生成 + 概念提取 |
| PostgreSQL + PostGIS | 14.22 | :5432 | 备用（终期迁移用，当前未使用）|

## 前端依赖

| 包 | 用途 |
|----|------|
| vue 3.5 | 视图框架 |
| vue-router 5.1 | 路由（hash 模式）|
| pinia 3.0 | 状态管理 |
| axios 1.18 | HTTP 请求 |
| element-plus 2.14 | 消息提示（ElMessage）|
| vite 8.0 | 构建工具 |

设计语言：Policy Journal（政策期刊）风格 — Source Serif 4 + Inter，forest green #2E7D5B

## 后端依赖

| 包 | 用途 |
|----|------|
| express 5.1 | HTTP 框架 |
| better-sqlite3 | SQLite 同步驱动 |
| neo4j-driver | Neo4j Bolt 客户端 |
| openai (SDK v4) | DeepSeek API 调用（OpenAI 兼容）|
| nodejieba | 中文分词（原生 C++ 模块）|
| dotenv | 环境变量加载 |
| typescript + ts-node | 编译运行 |

## Python 预处理依赖

| 包 | 用途 |
|----|------|
| pdfplumber | PDF 文本提取 |
| jieba | 中文分词 |
| scikit-learn | TF-IDF 向量化 |
| numpy | 向量存储与余弦相似度 |
| neo4j (Python driver) | 写入 Neo4j |
| joblib | 模型序列化 (.pkl) |
| requests | LLM API 调用 |

## 环境变量

后端 `.env`（从 `.env.example` 复制）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3000 | HTTP 端口 |
| DEEPSEEK_API_KEY | (必填) | DeepSeek API key |
| DEEPSEEK_BASE_URL | https://api.deepseek.com | API 地址 |
| DEEPSEEK_MODEL | deepseek-v4-flash | 模型名 |
| NEO4J_URI | bolt://localhost:7687 | Neo4j 地址 |
| NEO4J_USER | neo4j | Neo4j 用户名 |
| NEO4J_PASSWORD | (必填) | Neo4j 密码 |
| RETRIEVAL_TOP_K | 5 | RAG Top-K 数量 |

预处理 `ml-service/config.py`（已 gitignore）：

| 变量 | 说明 |
|------|------|
| LLM_CONFIG.api_key | DeepSeek API key |
| NEO4J_CONFIG.password | Neo4j 密码 |
