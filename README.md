# Geo-Knowledge Q&A

面向地质找矿场景的智能问答系统，结合 RAG 文档检索、Neo4j 知识图谱、LLM 回答生成和地图空间展示。

## Architecture

- `frontend/`: Vue 3, TypeScript, Vite, Element Plus, Pinia, ECharts and AntV G6.
- `backend/`: Node.js, Express, JWT, SSE streaming, Neo4j and SQLite integration.
- `ml-service/`: Flask retrieval service and offline PDF, chunking, embedding, NER and ontology pipelines.
- LLM providers: DeepSeek-compatible OpenAI API with an optional Tongyi provider.

Online questions combine document retrieval and knowledge-graph paths before generating an answer. Spatial entities returned by Neo4j can be rendered on the map. The bundled public mock files are fully synthetic and do not represent real deposits, documents or coordinates.

## Data Policy

This public repository contains source code only. It does not include original documents, parsed text, vector databases, trained models, knowledge-graph dumps, evaluation answers, course reports, API keys or passwords.

To run the full pipeline, use documents that you are legally permitted to process and generate all runtime artifacts locally. Do not commit those artifacts.

## Setup

### 1. Configuration

Create local configuration files from the committed templates:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
Copy-Item ml-service/config.example.py ml-service/config.py
```

Fill in your own DeepSeek-compatible API Key, Neo4j connection details and AMap browser credentials. These local files are ignored by Git.

### 2. ML retrieval service

```powershell
Set-Location ml-service
pip install -r requirements.txt
python scripts/run_pipeline.py
python server.py
```

The pipeline reads user-provided documents from the local paths configured in `config.py` and writes derived files under `ml-service/output/`.

### 3. Backend

```powershell
Set-Location backend
npm install
npm run dev
```

The Express API listens on `http://localhost:3000` by default.

### 4. Frontend

```powershell
Set-Location frontend
npm install
npm run dev
```

The Vite development server listens on `http://localhost:5173` and proxies `/api` to the backend.

## Service Order

1. Neo4j
2. Flask retrieval service on port 5000
3. Express backend on port 3000
4. Vue frontend on port 5173

Without locally generated retrieval data or Neo4j content, the application can still display its synthetic public demo states, but it will not provide real geological retrieval results.
