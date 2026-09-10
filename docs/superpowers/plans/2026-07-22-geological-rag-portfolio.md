# Geological RAG Portfolio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a recruitment-ready cover image, exactly 10-page PDF case study, and upload copy for the Geo-Knowledge Q&A project without exposing real project data.

**Architecture:** Keep editable JSON and Python builders under `portfolio/geo-knowledge-rag/source/`, generated figures under `assets/`, rendered PDF previews under `rendered/`, and the three upload-ready deliverables at the portfolio root. Build every diagram from synthetic structured data, compose the PDF with fixed A4-landscape bounds, then validate image dimensions, PDF structure, visible page content, copy length, and forbidden privacy patterns.

**Tech Stack:** GPT image generation, Python 3, Pillow, ReportLab, Poppler, pdfplumber, and the bundled workspace artifact runtime.

## Global Constraints

- Final cover: `1600 x 900`, PNG, less than 4 MB.
- Final PDF: exactly 10 pages, less than 20 MB.
- Final upload description: no more than 350 Chinese characters.
- Use only synthetic entities, coordinates, interface content, and question examples.
- Do not include real document titles, excerpts, database rows, API keys, passwords, machine paths, exact coordinates, or private course attachments.
- Use deep ink `#172733`, forest green `#2E7D5B`, mineral gold `#B58A3A`, and warm white `#F7F5EF`.
- Use GitHub project URL `https://github.com/winter-street/geo-knowledge-qa` and GitHub profile `https://github.com/winter-street`.
- Position the user as `全链路项目负责人 / Full-stack & AI Engineering` in a three-person course team; do not claim sole authorship.
- Use local Chinese-capable fonts and embed/subset them in the PDF; do not fetch fonts or third-party assets at build time.

## File Structure

```text
portfolio/geo-knowledge-rag/
|-- source/
|   |-- content.json              # Single source of truth for all copy and synthetic labels
|   |-- build_assets.py           # Cover composition and five technical diagrams
|   |-- build_portfolio.py        # Ten-page A4-landscape ReportLab document
|   `-- validate_portfolio.py     # Structural, privacy, image, PDF, and copy checks
|-- assets/
|   |-- cover-background.png      # Original text-free raster generated for this portfolio
|   |-- architecture.png
|   |-- offline-pipeline.png
|   |-- online-pipeline.png
|   |-- product-mock.png
|   `-- contribution-matrix.png
|-- rendered/
|   |-- page-01.png through page-10.png
|   `-- contact-sheet.png
|-- 地质知识图谱与RAG项目封面.png
|-- 地质知识图谱与RAG项目作品集.pdf
`-- 作品上传文案.txt
```

---

### Task 1: Build and Validate the Content Model

**Files:**
- Create: `portfolio/geo-knowledge-rag/source/content.json`
- Create: `portfolio/geo-knowledge-rag/作品上传文案.txt`
- Create: `portfolio/geo-knowledge-rag/source/validate_portfolio.py`
- Read: `github-public-source/README.md`
- Read: `docs/superpowers/specs/2026-07-22-geological-rag-portfolio-design.md`

**Interfaces:**
- Consumes: public-source project facts and the approved portfolio design.
- Produces: UTF-8 JSON with `meta`, `palette`, `github`, `privacy`, and exactly ten `pages`; UTF-8 upload copy; a validation CLI used by Tasks 2-4.

- [ ] **Step 1: Create the content model with exact page contracts**

Use this top-level structure and page sequence; each page object contains only portfolio-safe prose and synthetic examples:

```json
{
  "meta": {
    "title": "地质知识图谱与 RAG 增强智能问答系统",
    "role": "全链路项目负责人",
    "role_en": "Full-stack & AI Engineering",
    "team_context": "3 人课程设计团队",
    "synthetic_notice": "公开展示内容均为合成示例"
  },
  "palette": {
    "ink": "#172733",
    "green": "#2E7D5B",
    "gold": "#B58A3A",
    "paper": "#F7F5EF"
  },
  "github": {
    "repository": "https://github.com/winter-street/geo-knowledge-qa",
    "profile": "https://github.com/winter-street"
  },
  "privacy": {
    "synthetic_entities": ["演示矿物 A", "演示岩体 A", "演示构造 A"],
    "forbidden_content": ["真实文献标题", "原文片段", "数据库条目", "API Key", "密码", "本机路径", "精确坐标"]
  },
  "pages": [
    {"number": 1, "slug": "positioning", "title": "项目定位", "question": "这是什么项目？", "summary": "把分散的地质资料转化为可检索、可关联、可追溯的智能问答体验。", "evidence": ["RAG + Knowledge Graph + LLM + GIS"], "visual": "cover"},
    {"number": 2, "slug": "problem", "title": "业务问题", "question": "普通 LLM 为什么不够？", "summary": "地质找矿问答需要领域证据、关系推理和空间表达，单靠模型记忆无法稳定支撑。", "evidence": ["知识时效", "来源追溯", "实体关系", "空间位置"], "visual": "problem"},
    {"number": 3, "slug": "architecture", "title": "协同架构", "question": "RAG、KG、LLM 与 GIS 如何协同？", "summary": "文档检索与图谱检索并行取证，LLM 组织回答，地图和关系图承接空间与结构信息。", "evidence": ["双路检索", "证据融合", "可视化反馈"], "visual": "architecture"},
    {"number": 4, "slug": "offline", "title": "离线数据管线", "question": "地质资料如何成为可检索知识？", "summary": "离线管线完成解析、切片、向量化、地质实体抽取、图谱写入与本体推理。", "evidence": ["PDF → Chunk", "TF-IDF / BGE", "NER → Neo4j", "OWL"], "visual": "offline-pipeline"},
    {"number": 5, "slug": "online", "title": "在线问答链路", "question": "一次问题如何得到可溯源回答？", "summary": "请求经鉴权后并行查询文档、图谱和空间结果，再由网关生成并流式返回带来源的回答。", "evidence": ["JWT", "Promise.all", "LLM Gateway", "SSE"], "visual": "online-pipeline"},
    {"number": 6, "slug": "experience", "title": "产品体验", "question": "用户如何验证回答？", "summary": "问答正文、文献来源、知识路径与地图要素在同一任务流中互相印证。", "evidence": ["SourceCard", "KG Path", "地图联动", "合成示例"], "visual": "product-mock"},
    {"number": 7, "slug": "contribution", "title": "个人贡献", "question": "我负责了哪些关键工作？", "summary": "在三人课程团队中覆盖架构、前后端、检索管线、知识图谱、评测、联调与脱敏交付。", "evidence": ["全链路项目负责人", "Full-stack & AI Engineering"], "visual": "contribution-matrix"},
    {"number": 8, "slug": "challenges", "title": "工程难点", "question": "跨服务系统如何稳定落地？", "summary": "通过服务编排、检索降级、模型网关、流式协议和统一数据契约控制复杂度。", "evidence": ["依赖管理", "故障降级", "流式状态", "Schema 一致性"], "visual": "challenges"},
    {"number": 9, "slug": "verification", "title": "验证与隐私", "question": "如何证明系统可靠且可公开？", "summary": "结构测试、回答忠实性评测和发布前隐私扫描共同构成可验证的交付闭环。", "evidence": ["检索证据", "Groundedness", "凭证隔离", "合成数据"], "visual": "verification"},
    {"number": 10, "slug": "links", "title": "技术栈与链接", "question": "如何继续了解项目？", "summary": "公开仓库保留完整工程结构与合成演示状态，可继续审阅实现与运行说明。", "evidence": ["Vue 3", "Express", "Flask", "Neo4j", "GitHub"], "visual": "links"}
  ]
}
```

- [ ] **Step 2: Write the final upload copy**

Create `作品上传文案.txt` with four labeled sections: `作品名称`、`项目描述`、`项目链接`、`附件说明`. The `项目描述` body must be at most 350 Chinese characters and state the role, RAG + Neo4j dual retrieval, Vue/Express/Flask full-stack scope, traceability, GIS visualization, and synthetic public examples.

- [ ] **Step 3: Implement baseline content and privacy validation**

Create `validate_portfolio.py` with `ROOT = Path(__file__).resolve().parents[1]` and these stable callables:

- `load_content() -> dict`: decode `source/content.json` as UTF-8 and return the parsed object.
- `extract_upload_description(text: str) -> str`: return only the text between `项目描述：` and `项目链接：`.
- `find_privacy_violations(text: str) -> list[str]`: return unique rule names for every forbidden match.
- `validate_content() -> list[str]`: return human-readable errors for page count, numbering, required fields, copy length, URLs, or privacy.
- `validate_images() -> list[str]`: return errors for missing, malformed, oversized, blank, or wrongly sized PNGs.
- `validate_pdf() -> list[str]`: return errors for page count, file size, blank content streams, missing text, privacy, or links.
- `validate_rendered_pages() -> list[str]`: return errors for count, dimensions, near-white pages, or contact sheet.
- `main() -> int`: print a concise manifest and return `0` only when every selected validation group passes.

The forbidden regex list must detect likely credentials (`sk-` plus 16 or more token characters, `api_key`/`password` followed by a value), Windows absolute paths (`[A-Za-z]:\\`), IPv4 coordinates/hosts, longitude-latitude decimal pairs, and private-data terms (`parsed_texts.json`, `geo_knowledge.db`, `config.py`, `真实文献`). Allow only the two approved GitHub URLs.

- [ ] **Step 4: Run the content-only validation**

Run:

```powershell
python portfolio/geo-knowledge-rag/source/validate_portfolio.py --content-only
```

Expected: exit code `0`, `10 pages`, `description <= 350 characters`, and `0 privacy violations`.

- [ ] **Step 5: Commit the content model**

```powershell
git add portfolio/geo-knowledge-rag/source/content.json portfolio/geo-knowledge-rag/source/validate_portfolio.py portfolio/geo-knowledge-rag/作品上传文案.txt
git commit -m "docs: add geological RAG portfolio content"
```

### Task 2: Create the Cover and Technical Visual Assets

**Files:**
- Create: `portfolio/geo-knowledge-rag/assets/cover-background.png`
- Create: `portfolio/geo-knowledge-rag/source/build_assets.py`
- Create: `portfolio/geo-knowledge-rag/地质知识图谱与RAG项目封面.png`
- Create: `portfolio/geo-knowledge-rag/assets/architecture.png`
- Create: `portfolio/geo-knowledge-rag/assets/offline-pipeline.png`
- Create: `portfolio/geo-knowledge-rag/assets/online-pipeline.png`
- Create: `portfolio/geo-knowledge-rag/assets/product-mock.png`
- Create: `portfolio/geo-knowledge-rag/assets/contribution-matrix.png`

**Interfaces:**
- Consumes: `content.json`, a text-free generated background, and local font files.
- Produces: a `1600 x 900` final cover plus five `2200 x 1240` print-ready diagrams.

- [ ] **Step 1: Generate the original text-free cover background**

Use the image generation skill with this brief: `dark editorial geological contour field; abstract non-geographic strata; restrained forest-green knowledge nodes; thin mineral-gold retrieval paths; subtle technical grid; generous quiet area on the left for later typography; no text, labels, logos, satellite imagery, recognizable geography, exact coordinates, gradients, bloom, or glow`. Save the result as `assets/cover-background.png`.

- [ ] **Step 2: Implement deterministic asset drawing**

Create `build_assets.py` with `CANVAS = (2200, 1240)` and `COVER = (1600, 900)`. Its stable callables are `load_fonts()` for resolving local Chinese fonts, `fit_text()` for shrinking text to a fixed width, `draw_cover()` for the final 16:9 cover, `draw_architecture()`, `draw_offline_pipeline()`, `draw_online_pipeline()`, `draw_product_mock()`, `draw_contribution_matrix()`, and `main()` for building all six outputs.

Use Pillow primitives, 1-2 px rules, square/low-radius panels, fixed layout bounds, and labels from `content.json`. Use `演示矿物 A`、`演示岩体 A`、`演示构造 A` in the product mock and omit all numeric map coordinates.

- [ ] **Step 3: Build all assets**

Run:

```powershell
python portfolio/geo-knowledge-rag/source/build_assets.py
```

Expected: six PNG files are created; the final cover is `1600 x 900`; each technical figure is `2200 x 1240`.

- [ ] **Step 4: Validate image files**

Run:

```powershell
python portfolio/geo-knowledge-rag/source/validate_portfolio.py --images-only
```

Expected: exit code `0`; cover below `4 MB`; all images decode; each image has non-zero pixel variance and at least 3% non-background pixels.

- [ ] **Step 5: Inspect the cover and five diagrams**

Open the six generated PNGs with the local image viewer. Check Chinese glyphs, edge clipping, line crossings, title contrast, consistent margins, and that no synthetic label is mistaken for real data. Fix `build_assets.py`, rebuild, and rerun `--images-only` for any failed check.

- [ ] **Step 6: Commit the visual assets**

```powershell
git add portfolio/geo-knowledge-rag/source/build_assets.py portfolio/geo-knowledge-rag/assets portfolio/geo-knowledge-rag/地质知识图谱与RAG项目封面.png
git commit -m "docs: create geological RAG portfolio visuals"
```

### Task 3: Generate the 10-Page PDF

**Files:**
- Create: `portfolio/geo-knowledge-rag/source/build_portfolio.py`
- Create: `portfolio/geo-knowledge-rag/地质知识图谱与RAG项目作品集.pdf`

**Interfaces:**
- Consumes: `content.json`, the final cover, and five technical diagram PNGs.
- Produces: an A4-landscape PDF with exactly 10 pages, extractable Chinese text on pages 2-10, embedded metadata, and clickable GitHub links.

- [ ] **Step 1: Implement the ReportLab page system**

Create `build_portfolio.py` with `PAGE_W, PAGE_H = landscape(A4)`, `MARGIN_X = 42`, `MARGIN_TOP = 36`, and `MARGIN_BOTTOM = 30`. Its stable callables are `register_fonts()` for local font registration, `draw_header()` and `draw_footer()` for repeated chrome, `draw_wrapped_text()` for width-constrained paragraphs, `draw_figure()` for aspect-fit images, `draw_evidence_list()` for compact proof points, and `build_pdf()` for the ten-page document.

Register a local Chinese sans font for body copy and a Chinese serif font for display headings. Keep every page element inside `MARGIN_X .. PAGE_W-MARGIN_X` and `MARGIN_BOTTOM .. PAGE_H-MARGIN_TOP`.

- [ ] **Step 2: Compose exactly ten pages**

Page 1 places the final cover full bleed. Pages 2-10 use warm-white editorial layouts with one core question, a concise summary, evidence list, and one dominant visual. Map figures as follows: page 3 `architecture.png`, page 4 `offline-pipeline.png`, page 5 `online-pipeline.png`, page 6 `product-mock.png`, page 7 `contribution-matrix.png`; draw pages 2 and 8-10 directly with ReportLab rules, metrics, challenge/response rows, verification checks, technology labels, and links.

- [ ] **Step 3: Add metadata and clickable links**

Set title to `地质知识图谱与 RAG 增强智能问答系统｜项目作品集`, author to `全链路项目负责人 / Full-stack & AI Engineering`, subject to `RAG、知识图谱、LLM 与 GIS 融合项目案例`, and keywords to `RAG, Neo4j, LLM, GIS, Vue, Express, Flask`. Add link annotations around the repository and profile URLs on page 10.

- [ ] **Step 4: Build and structurally validate the PDF**

Run:

```powershell
python portfolio/geo-knowledge-rag/source/build_portfolio.py
python portfolio/geo-knowledge-rag/source/validate_portfolio.py --pdf-only
```

Expected: exit code `0`; exactly `10 pages`; PDF below `20 MB`; pages 2-10 have extractable text; every page has a non-empty content stream; both approved GitHub URLs appear in page-10 annotations or extracted text.

- [ ] **Step 5: Commit the PDF builder and document**

```powershell
git add portfolio/geo-knowledge-rag/source/build_portfolio.py portfolio/geo-knowledge-rag/地质知识图谱与RAG项目作品集.pdf
git commit -m "docs: build geological RAG portfolio PDF"
```

### Task 4: Render, Review, and Finalize

**Files:**
- Create: `portfolio/geo-knowledge-rag/rendered/page-01.png` through `page-10.png`
- Create: `portfolio/geo-knowledge-rag/rendered/contact-sheet.png`
- Finalize: `portfolio/geo-knowledge-rag/地质知识图谱与RAG项目封面.png`
- Finalize: `portfolio/geo-knowledge-rag/地质知识图谱与RAG项目作品集.pdf`
- Finalize: `portfolio/geo-knowledge-rag/作品上传文案.txt`

**Interfaces:**
- Consumes: all artifacts from Tasks 1-3.
- Produces: upload-ready files, page previews, and a machine-readable validation result printed to the terminal.

- [ ] **Step 1: Render all PDF pages**

Use Poppler at 150 DPI:

```powershell
pdftoppm -png -r 150 -f 1 -l 10 portfolio/geo-knowledge-rag/地质知识图谱与RAG项目作品集.pdf portfolio/geo-knowledge-rag/rendered/page
```

Rename outputs deterministically to `page-01.png` through `page-10.png`, then generate a `5 x 2` contact sheet in `validate_portfolio.py` without deleting the individual pages.

- [ ] **Step 2: Validate rendered pages**

Run:

```powershell
python portfolio/geo-knowledge-rag/source/validate_portfolio.py --rendered-only
```

Expected: exactly ten consistently sized page images; no page has more than 98% near-white pixels; contact sheet exists and has non-zero pixel variance.

- [ ] **Step 3: Perform visual QA**

Inspect `contact-sheet.png`, then pages 3-7 at original resolution. Check all page edges, Chinese font rendering, paragraph wrapping, diagrams, link text, contrast, overlaps, blank regions, and numbering. Fix the responsible source script, rebuild affected artifacts, rerender all pages, and rerun the relevant validation mode.

- [ ] **Step 4: Run final privacy and artifact validation**

Extract PDF text with pdfplumber and scan `content.json`, `作品上传文案.txt`, extracted PDF text, and all labels supplied to the image builder. Reject credential patterns, Windows absolute paths, private filenames, raw document excerpts, exact coordinate pairs, and unknown external URLs.

Run:

```powershell
python portfolio/geo-knowledge-rag/source/validate_portfolio.py --all
git diff --check -- portfolio/geo-knowledge-rag
```

Expected: `PASS` for content, images, PDF, rendered pages, copy length, GitHub links, and privacy; `git diff --check` has no output.

- [ ] **Step 5: Record the final manifest and commit**

The validator must print: cover dimensions and bytes, PDF page count and bytes, upload-description character count, approved GitHub URL, and the three absolute deliverable paths.

```powershell
git add portfolio/geo-knowledge-rag
git commit -m "docs: finalize geological RAG recruitment portfolio"
```
