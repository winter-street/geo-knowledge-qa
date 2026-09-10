# Focused Defense Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a ten-slide editable PowerPoint deck that demonstrates RAG, Neo4j, OWL inference, and online QA through one geology question.

**Architecture:** A standalone Python presentation builder under `scripts/` creates the PPTX from verified project code and existing assets. It uses editable shapes and text boxes, then validates the result by reopening the package with `python-pptx`.

**Tech Stack:** Python 3.10+, `python-pptx`, PowerPoint Open XML package inspection, existing local PPTX assets.

## Global Constraints

- Output: `docs/地理知识图谱与RAG增强的智能问答系统-终期汇报-重点版.pptx`.
- Format: editable 16:9 PPTX with no externally hosted resources.
- Only project-verified facts: 44 documents, 3454 chunks, 512-dimensional BGE vectors, seven Neo4j node labels, eight relationship types, and offline OWL inference.
- Distinguish completed implementation from `demo-v1` and unbenchmarked claims.
- Use warm white, ink, mineral green, and ochre; no gradients, emoji, fabricated metrics, or decorative full-graph webs.

---

### Task 1: Collect verified source material

**Files:**
- Read: `docs/superpowers/specs/2026-07-14-defense-presentation-design.md`
- Read: `ml-service/server.py`
- Read: `backend/src/routes/qa.ts`
- Read: `ml-service/scripts/run_reasoning.py`
- Read: `docs/地理知识图谱与RAG增强的智能问答系统-答辩-修订版-v2.pptx`
- Create: `docs/assets/defense-focus/`

**Produces:** Code locations and inspected local visual assets usable in the deck.

- [ ] **Step 1: Confirm the online retrieval and inference facts.**

Run:

```powershell
rg -n "def _search_bge|chunk_vectors @ q_vec|Promise\.all|generateAnswerStream|BELONGS_TO|LIES_IN|inferred" ml-service/server.py backend/src/routes/qa.ts ml-service/scripts/run_reasoning.py
```

Expected: matches identify the BGE Top-K operation, parallel retrieval, SSE generation, and inferred-edge write-back.

- [ ] **Step 2: Extract only real assets from the existing PPTX.**

Run:

```powershell
Expand-Archive -LiteralPath 'docs/地理知识图谱与RAG增强的智能问答系统-答辩-修订版-v2.pptx' -DestinationPath "$env:TEMP\defense-pptx" -Force
Copy-Item -LiteralPath "$env:TEMP\defense-pptx\ppt\media\*" -Destination 'docs/assets/defense-focus' -Force
```

Expected: assets are local and can be visually inspected before use.

### Task 2: Build the editable ten-slide deck

**Files:**
- Create: `scripts/build_focus_defense_ppt.py`
- Create: `docs/地理知识图谱与RAG增强的智能问答系统-终期汇报-重点版.pptx`

**Consumes:** The approved design specification, verified code references, and inspected assets from Task 1.

**Produces:** Ten editable slides and an assertion that prevents an incorrect slide count.

- [ ] **Step 1: Write the output validation before slide implementation.**

Add the following to the builder:

```python
from pptx import Presentation

EXPECTED_SLIDE_COUNT = 10

def verify_slide_count(path: str) -> None:
    actual = len(Presentation(path).slides)
    assert actual == EXPECTED_SLIDE_COUNT, f"Expected {EXPECTED_SLIDE_COUNT} slides, got {actual}"
```

- [ ] **Step 2: Add shared visual primitives.**

Define `add_title`, `add_footer`, `add_label`, `add_step_box`, `add_code_excerpt`, and `add_arrow`. Use the editable wide layout and the following fixed colors:

```python
INK = "18212B"
PAPER = "F6F2E9"
MINERAL = "2E7D5B"
OCHRE = "B66A2C"
```

- [ ] **Step 3: Create slides 1-4.**

Build title/positioning, requirements/deliverables, the question-led dual-evidence route, and offline knowledge construction. Each slide contains one primary diagram and no full graph web.

- [ ] **Step 4: Create slides 5-8.**

Build RAG, Neo4j graph construction, OWL inference, and online orchestration. Every core module visibly identifies `输入`, `处理`, `输出`, `效果`, and a code location. The OWL slide shows the before/after inferred edge and `inferred: true`, plus that it is offline.

- [ ] **Step 5: Create slides 9-10.**

Build a video and IDE runbook using `_search_bge`, `POST /api/qa/ask`, and `run_reasoning.py`; close with completed capabilities, real boundaries, and the conclusion. Put single-presenter timing in each footer.

- [ ] **Step 6: Generate and validate the deck.**

Run:

```powershell
$env:PORTFOLIO_PYTHON scripts/build_focus_defense_ppt.py
```

Expected: the PPTX exists and prints `Validated 10 slides`.

### Task 3: Validate and hand off the deck

**Files:**
- Read: `docs/地理知识图谱与RAG增强的智能问答系统-终期汇报-重点版.pptx`
- Create: `docs/地理知识图谱与RAG增强的智能问答系统-终期汇报-重点版-讲稿.md`

**Produces:** A readable PPTX and a single-presenter runbook targeting seven minutes and twenty seconds.

- [ ] **Step 1: Verify package readability and slide count.**

Run:

```powershell
$env:PORTFOLIO_PYTHON -c "from pptx import Presentation; p=Presentation(r'docs/地理知识图谱与RAG增强的智能问答系统-终期汇报-重点版.pptx'); assert len(p.slides)==10; print('PPTX readable; 10 slides')"
```

Expected: `PPTX readable; 10 slides`.

- [ ] **Step 2: Check for a local renderer.**

Run:

```powershell
Get-Command soffice -ErrorAction SilentlyContinue
```

If present, export to PDF and inspect every page. If absent, verify all image relationships resolve and state that renderer-based inspection was unavailable.

- [ ] **Step 3: Write the compact narration guide.**

Create a Markdown guide with one to three sentences per slide, total target 7:20, and an IDE jump list for `_search_bge`, `POST /api/qa/ask`, and `run_reasoning.py`.

- [ ] **Step 4: Commit the generated deliverables.**

Run:

```powershell
git add scripts/build_focus_defense_ppt.py docs/地理知识图谱与RAG增强的智能问答系统-终期汇报-重点版.pptx docs/地理知识图谱与RAG增强的智能问答系统-终期汇报-重点版-讲稿.md
git commit -m "docs: add focused defense presentation"
```

## Self-Review

- The three tasks cover all ten approved slides, the single-speaker timing, code evidence, and package/visual validation.
- Output names and code locations are consistent across the plan.
- No placeholder facts or unverified performance claims are included.
