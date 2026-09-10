# 《原神》数值策划作品附件实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一份经过公开资料核验、包含可复核数值案例并通过逐页视觉检查的《原神》战斗与角色养成系统拆解 Word 文档。

**Architecture:** 使用独立的 `portfolio/genshin-numerical-design/` 工作目录维护资料台账、内容草稿、计算脚本和图表；使用 `python-docx` 生成 DOCX，再通过文档技能提供的渲染器输出 PNG 进行逐页质检。最终只向用户交付 `output/docx/《原神》战斗与角色养成系统拆解-张晓凯.docx`。

**Tech Stack:** Markdown、Python 3、python-docx、matplotlib、LibreOffice/Poppler 渲染工具。

## Global Constraints

- A4 纵向，目标 8 页，允许 7 至 10 页。
- 定位为网易互娱游戏设计师（数值策划）网申作品附件。
- 至少 8 个公开来源，包含官方资料、公式资料和社区/统计资料。
- 所有精确数值必须有来源或明确标注为案例假设。
- 至少包含 1 个核心循环图、1 个伤害乘区图、2 张参数/对比表和 1 个可复核计算案例。
- 区分公开机制、外部统计、个人推断与优化建议。
- 不虚构官方内部数据、线上实验结果、留存率、付费率或角色强度结论。

---

### Task 1: 建立资料台账与版本口径

**Files:**
- Create: `portfolio/genshin-numerical-design/sources.md`
- Create: `portfolio/genshin-numerical-design/research-notes.md`

- [ ] 核验用户提供的贴吧讨论和伤害公式页面，记录页面标题、URL、访问日期、可用论点与可信度限制。
- [ ] 收集至少 6 个补充来源，优先官方公告、官方角色/系统说明、可靠机制资料库及披露样本范围的社区统计。
- [ ] 在研究笔记中冻结公式口径：基础伤害、增伤区、暴击期望、防御乘区、抗性乘区及反应乘区分别处理。
- [ ] 明确数值案例使用的角色/队伍、等级、天赋、武器、圣遗物、敌人等级和抗性假设。
- [ ] 运行 `rg -n "待定|TBD|TODO" portfolio/genshin-numerical-design`，预期无未解决占位符。

### Task 2: 构建可复核数值案例

**Files:**
- Create: `portfolio/genshin-numerical-design/calculate_case.py`
- Create: `portfolio/genshin-numerical-design/calculation-output.json`
- Create: `portfolio/genshin-numerical-design/charts/`

- [ ] 编写纯函数计算期望伤害：`expected_damage(base_damage, damage_bonus, crit_rate, crit_damage, defense_multiplier, resistance_multiplier, reaction_multiplier)`。
- [ ] 为基准方案与对照方案设置显式输入，不从网络或随机数读取参数。
- [ ] 输出每个乘区、总伤害、相对提升率和敏感性分析结果到 JSON。
- [ ] 生成核心循环图、伤害乘区图和敏感性对比图，统一使用深海军蓝、低饱和金色和灰色。
- [ ] 运行脚本两次并比较输出哈希，确认结果确定性一致。

### Task 3: 完成正文与引用

**Files:**
- Create: `portfolio/genshin-numerical-design/content.md`

- [ ] 按规格完成执行摘要、拆解方法、核心循环、战斗系统、伤害模型、养成资源、计算案例、优化建议、指标实验和结论。
- [ ] 对每条精确公式和机制结论添加来源编号；对案例参数添加“案例假设”标签。
- [ ] 优化建议采用“现象 - 假设 - 数据需求 - 方案 - 风险 - 验证指标”结构。
- [ ] 文末列出完整来源、访问日期、用途和样本限制。
- [ ] 检查正文不出现“官方认为”“证明有效”“显著提升”等无证据结论。

### Task 4: 生成 Word 文档

**Files:**
- Create: `portfolio/genshin-numerical-design/build_docx.py`
- Create: `output/docx/《原神》战斗与角色养成系统拆解-张晓凯.docx`

- [ ] 基于 `standard_business_brief` 创建具名视觉覆盖：A4、微软雅黑/Aptos、深海军蓝、低饱和金色、浅灰表格。
- [ ] 使用 `editorial_cover` 首页模式，正文配置安静页眉、页码和“个人学习拆解，非官方资料”页脚。
- [ ] 使用 Word 原生段落、标题、编号和固定宽度表格；插入 3 张高分辨率图表。
- [ ] 写入正文、计算结果和至少 8 条可点击参考链接。
- [ ] 运行元数据清理脚本，移除生成器和本机用户名信息。

### Task 5: 渲染与视觉质检

**Files:**
- Create: `tmp/genshin-docx-render/page-*.png`

- [ ] 使用文档技能的 `render_docx.py` 渲染最终 DOCX。
- [ ] 逐页检查标题层级、字体、图表清晰度、表格断页、引用链接、页眉页脚和文字溢出。
- [ ] 对发现的问题修改构建脚本并重新生成、重新渲染，直到全部页面无可见缺陷。
- [ ] 运行结构检查，确认 A4 页面、7 至 10 页、至少 3 张图片、至少 2 张表格和至少 8 个外部链接。
- [ ] 仅保留最终 DOCX 作为交付物，渲染 PNG 留作内部验证。

### Task 6: 最终事实与交付审计

**Files:**
- Inspect: `portfolio/genshin-numerical-design/sources.md`
- Inspect: `portfolio/genshin-numerical-design/calculation-output.json`
- Inspect: `output/docx/《原神》战斗与角色养成系统拆解-张晓凯.docx`

- [ ] 将文档中的公式、参数和引用逐项与资料台账、JSON 输出核对。
- [ ] 确认社区统计均注明样本偏差，案例计算均注明假设，不含虚构官方数据。
- [ ] 检查最终 DOCX 可打开、非空、页数符合范围且最新渲染通过。
- [ ] 向用户交付唯一最终 Word 文件并简述文档定位。
