# API 接口约定

> 前端（A 同学）与后端（B 同学）共同遵守。所有接口前缀 `/api`，无鉴权中间件（中期简化）。

---

## POST /api/qa/ask

核心问答接口。接收用户问题，执行双路检索（RAG + KG），调用 LLM 生成回答。

**Request**
```json
{
  "question": "养老院属于什么用地类型？"
}
```

**Response**
```json
{
  "answer": "根据《用地用海分类指南》，养老院属于社会福利用地（编码0807），隶属于公共管理与公共服务用地（编码08）大类...",
  "sources": [
    {
      "docId": 1,
      "docTitle": "用地用海分类指南",
      "page": 12,
      "snippet": "社会福利用地（0807）包括老年人社会福利用地..."
    }
  ],
  "kgContext": [
    { "from": "养老院", "relation": "CLASSIFIED_AS", "to": "社会福利用地" },
    { "from": "社会福利用地", "relation": "BELONGS_TO", "to": "公共管理与公共服务用地" }
  ]
}
```

**错误码**

| 状态 | 含义 |
|------|------|
| 200 | 成功（无 API key 时返回 mock 回答）|
| 400 | question 为空 |
| 500 | 内部错误 |

---

## GET /api/kg/subgraph

获取指定关键词的 Neo4j 子图数据，供前端 GraphView 可视化展示。

**Query Params**
```
?keyword=养老
```

**Response**
```json
{
  "nodes": [
    { "id": "n1", "label": "养老院", "type": "Entity" },
    { "id": "n2", "label": "社会福利用地", "type": "LandUse" },
    { "id": "n3", "label": "公共管理与公共服务用地", "type": "Concept" }
  ],
  "edges": [
    { "source": "n1", "target": "n2", "label": "CLASSIFIED_AS" },
    { "source": "n2", "target": "n3", "label": "BELONGS_TO" }
  ]
}
```

前端渲染时优先取关系属性 `display`（中文标签：属于/管控/约束/引用），不存在时回退到 `label`。

**错误码**

| 状态 | 含义 |
|------|------|
| 200 | 成功（Neo4j 不可用时返回空 `{nodes:[], edges:[]}`）|
| 400 | keyword 为空 |
| 500 | 内部错误 |

---

## POST /api/auth/login

模拟登录（中期简化版，任意非空账号密码均可登录）。

**Request**
```json
{
  "username": "admin",
  "password": "admin"
}
```

**Response**
```json
{
  "token": "token-1718230400000",
  "username": "admin",
  "role": "admin"
}
```

---

## GET /api/admin/stats

系统概览指标。

**Response**
```json
{
  "docCount": 2,
  "chunkCount": 121
}
```

> 注意：当前仅返回 SQLite 统计。Neo4j 节点数（nodeCount）和问答次数（qaCount）待后续版本补上。

---

## GET /api/admin/docs

文档列表（聚合自 SQLite chunks）。

**Response**
```json
[
  {
    "docId": 1,
    "title": "市级国土空间总体规划编制指南",
    "domain": "国土空间规划",
    "docType": "政策文件",
    "status": "completed",
    "chunkCount": 66,
    "uploadedAt": "2026-07-01"
  }
]
```

---

## GET /api/admin/docs/:id

文档详情（单个 chunk 的完整内容）。

**Response**
```json
{
  "docId": 1,
  "title": "市级国土空间总体规划编制指南",
  "domain": "国土空间规划",
  "docType": "政策文件",
  "status": "completed",
  "chunkCount": 66,
  "uploadedAt": "2026-07-01",
  "content": "为贯彻落实《中共中央 国务院关于建立国土空间规划体系并监督实施的若干意见》...",
  "page": 2
}
```

---

## GET /api/health

健康检查。

**Response**
```json
{
  "status": "ok",
  "timestamp": "2026-07-05T12:00:00.000Z"
}
```
