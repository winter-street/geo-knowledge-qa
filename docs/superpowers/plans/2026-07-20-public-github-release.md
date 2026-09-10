# Public GitHub Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a source-only, history-free version of Geo-Knowledge Q&A to `https://github.com/winter-street/geo-knowledge-qa.git` without exposing real or derived project data.

**Architecture:** Build a new repository at `D:\1GISwork\6-GISdevelop\github-public-source` from an explicit source whitelist. The public repository receives a new `main` history and never imports objects or commits from the private/Gitee repository.

**Tech Stack:** PowerShell, Git, Vue 3/Vite/TypeScript, Node.js/Express/TypeScript, Python/Flask.

## Global Constraints

- Do not push the current repository's `master` or any existing Git objects.
- Do not copy `data/`, `ml-service/output/`, `ml-service/models/`, evaluation outputs, real `.env`, `config.py`, course bundles, binary reports, videos, databases, model artifacts, dumps, CoNLL files, or local tool configuration.
- Preserve `.env.example` and `config.example.py` only after secret-pattern inspection.
- Initialize the public repository with a single `main` commit.
- Push only after forbidden-path, secret-pattern, large-file, build, and selected-test checks pass.

---

### Task 1: Create the Public Source Export

**Files:**
- Create: `github-public-source/README.md`
- Create: `github-public-source/.gitignore`
- Copy: public source files from `frontend/`, `backend/`, and `ml-service/`
- Copy: selected Markdown documentation and root configuration files

**Interfaces:**
- Consumes: the current working tree as a source snapshot.
- Produces: a standalone source directory without `.git` history or runtime data.

- [ ] **Step 1: Create a clean export directory**

Verify `github-public-source/` does not contain prior content. If it exists, stop rather than overwrite it.

- [ ] **Step 2: Copy frontend source**

Copy `frontend/src/`, `frontend/public/`, `.env.example`, `DESIGN.md`, `README.md`, `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, and TypeScript configuration files. Exclude `.env`, `dist/`, `node_modules/`, generated auto-import declarations, and local-only directories.

- [ ] **Step 3: Copy backend source**

Copy `backend/src/`, `backend/scripts/`, `backend/tests/`, `.env.example`, `package.json`, `package-lock.json`, `tsconfig.json`, and `test-qa.mjs`. Exclude `.env`, `dist/`, `node_modules/`, `uploads/`, and `evaluation/` data.

- [ ] **Step 4: Copy ML service source**

Copy `ml-service/app/`, `ml-service/scripts/*.py`, `server.py`, `startup_health.py`, `verify_env.py`, `test_*.py`, `dashboard.html`, `requirements.txt`, `config.example.py`, and `CODE_INDEX.md`. Exclude `config.py`, `output/`, `models/`, `eval/`, caches, and all data/model artifact extensions.

- [ ] **Step 5: Add public documentation**

Create a public README describing architecture, local setup, required user-supplied data and credentials, and the absence of bundled datasets. Add a public `.gitignore` that blocks secrets, datasets, runtime outputs, models, binary reports, archives, logs, dependencies, and build output.

### Task 2: Audit the Export

**Files:**
- Inspect: all files under `github-public-source/`

**Interfaces:**
- Consumes: Task 1 export.
- Produces: evidence that the export contains only approved source content.

- [ ] **Step 1: Check forbidden names and extensions**

Fail if the export contains `.env`, `config.py`, `data/`, `output/`, `models/`, `evaluation/`, `*.db`, `*.pdf`, `*.tif`, `*.pkl`, `*.dump`, `*.conll`, `*.zip`, `*.pptx`, `*.docx`, `*.mp4`, or `*.log`.

- [ ] **Step 2: Check file sizes**

Fail if any export file exceeds 50 MB and review every file over 5 MB.

- [ ] **Step 3: Scan secrets and local paths**

Report filenames only for matches resembling live `sk-` credentials, assigned DeepSeek/OpenAI/AMap keys, Neo4j passwords, JWT secrets, or Windows absolute paths. Placeholder values in example templates must be visibly non-secret.

- [ ] **Step 4: Review the complete file manifest**

Confirm the export contains source, templates, tests, and documentation only.

### Task 3: Verify the Source Snapshot

**Files:**
- Test: `frontend/`
- Test: `backend/`
- Test: selected dependency-light `ml-service/test_*.py`

**Interfaces:**
- Consumes: exported source code.
- Produces: fresh build and test results before publication.

- [ ] **Step 1: Run the frontend build in the source workspace**

Run: `npm run build` from `frontend/`.
Expected: Vue TypeScript checking and Vite build exit with code 0.

- [ ] **Step 2: Run the backend build**

Run: `npm run build` from `backend/`.
Expected: TypeScript compilation exits with code 0.

- [ ] **Step 3: Run dependency-light ML tests**

Run the PDF-independent chunking, extraction, and BIO-format tests that do not require real data, API keys, Neo4j, or downloaded models.
Expected: each selected test exits with code 0.

### Task 4: Initialize and Publish the Repository

**Files:**
- Create: `github-public-source/.git/`

**Interfaces:**
- Consumes: audited export and verification evidence.
- Produces: GitHub repository `winter-street/geo-knowledge-qa` on branch `main`.

- [ ] **Step 1: Initialize a fresh Git repository**

Run: `git init -b main` in `github-public-source/`.
Expected: empty repository on `main`; no connection to the current repository's objects.

- [ ] **Step 2: Stage and inspect**

Run: `git add .`, followed by staged manifest and staged secret/large-file checks.
Expected: only audited files appear in the index.

- [ ] **Step 3: Create the initial commit**

Run: `git commit -m "Initial public source release"`.
Expected: exactly one root commit.

- [ ] **Step 4: Add GitHub remote and push**

Run: `git remote add origin https://github.com/winter-street/geo-knowledge-qa.git`, then `git push -u origin main`.
Expected: GitHub accepts `main` without large-file or secret-protection rejection.

- [ ] **Step 5: Verify the remote**

Run: `git ls-remote --heads origin main` and compare the returned commit with local `HEAD`.
Expected: hashes match.
