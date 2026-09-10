# GitHub 公开源码版发布设计

## 目标

将地质找矿智能问答系统发布到公开 GitHub 仓库 `winter-street/geo-knowledge-qa`，用于展示工程代码和技术架构，同时确保真实数据、由真实数据生成的产物、课程交付附件及所有凭证均不会进入公开仓库或 Git 历史。

## 发布方式

不直接推送当前 `master`。当前仓库历史曾追踪 PDF、解析文本、Neo4j dump、NER 语料和其他运行产物，仅添加 `.gitignore` 无法清除历史内容。

在工作区旁创建独立的公开发布目录，复制经白名单筛选的源码，初始化全新的 `main` 分支和 Git 历史，然后连接 GitHub 远程仓库并推送。

## 公开内容

- `frontend/`：Vue 源码、静态资源、构建配置、依赖清单和 `.env.example`。
- `backend/`：Express 源码、通用测试、构建配置、依赖清单和 `.env.example`。
- `ml-service/`：Flask 服务、通用处理脚本、通用测试、依赖清单和 `config.example.py`。
- 根目录启动脚本、`.gitignore`、技术说明与重新编写的公开版 `README.md`。
- 仅包含架构和接口说明、不包含真实数据内容的 Markdown 文档。

## 禁止公开内容

- 当前 `.git/` 历史与 Gitee 远程信息。
- `data/`、原始 PDF、GeoTIFF、SQLite、模型文件、pickle、Neo4j dump、CoNLL 语料和解析文本。
- `ml-service/output/`、`ml-service/models/`、`backend/evaluation/output/`、评测回答和运行日志。
- 课程 ZIP、课程设计副本、PPT、Word 报告、录屏视频和其他二进制交付附件。
- `.env`、`config.py`、API Key、Neo4j 密码、JWT Secret 及本机绝对路径。
- `node_modules/`、`dist/`、虚拟环境、缓存和 IDE/Agent 配置。

## 安全校验

发布前执行以下检查：

1. 检查禁止目录、禁止扩展名和大于 50 MB 的文件。
2. 扫描常见 DeepSeek/OpenAI Key、高德 Key/Secret、Neo4j 密码、JWT Secret 和本机路径模式。
3. 确认 Git 暂存清单只包含公开白名单内容。
4. 在公开副本中运行前端与后端构建，以及不依赖真实数据的测试。
5. 创建单一初始提交并推送到 GitHub `main`。

## 公开仓库行为

公开仓库仅提供源码和配置模板，不承诺开箱即用的真实检索效果。README 明确说明完整运行需要用户自行准备合法数据、API Key、Neo4j 实例，并执行预处理管线生成本地运行数据。
