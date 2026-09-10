# OWL 本体构建 + HermiT 推理

> 日期: 2026-07-09 | 角色: C（Python 预处理）| 状态: ✅ 已完成

## 背景

中期答辩后转向地质找矿，但前段「数据处理流 + 检索流」跨领域通用。OWL 本体是知识图谱的语义层补充——用形式化本体定义类层级、关系属性和公理，通过 HermiT 推理机推导隐含关系（如传递性 BELONGS_TO），再写回 Neo4j 供问答链路消费。

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 本体语言 | OWL 2 (RDF/XML) | owlready2 原生支持，HermiT 推理机兼容 |
| 推理机 | HermiT (owlready2 内置) | Java 实现，0.5s 完成推理，无需额外安装 |
| 数据来源 | 硬编码后备 + Neo4j 可选导入 | Neo4j 不在线时仍可构建本体 |
| 写回方式 | MERGE INFERRED_RELATED 关系 | 不破坏已有图结构，推理关系独立标记 |
| Flask 集成 | 3 个新端点 | 状态查询 / 推理执行 / 实体关系查询 |

## 本体结构

### 类层级 (10 类)

```
Thing
├── LandUse (用地分类)
│   ├── LandUseMajor (大类, 23 实例)
│   └── LandUseMinor (中类, 18 实例)
├── Concept (规划概念)
│   ├── SpatialControl (空间管控, 3 实例)
│   ├── PlanningIndicator (规划指标, 3 实例)
│   ├── FunctionalZone (功能分区, 3 实例)
│   ├── PolicyRequirement (政策要求, 3 实例)
│   └── Entity (实体, 0 实例)
└── Document (文档, 0 实例)
```

### 对象属性 (5 个)

| 属性 | 定义域 | 值域 | 特性 |
|------|--------|------|------|
| BELONGS_TO | Thing | Thing | **传递性** |
| GOVERNS | Concept | Thing | — |
| CONSTRAINS | Concept | Thing | — |
| REFERENCES | Thing | Thing | — |
| INFERRED_RELATED | Thing | Thing | 推理机自动生成 |

### 数据属性 (4 个)

| 属性 | 定义域 | 值域 |
|------|--------|------|
| has_code | LandUse | str |
| has_level | LandUse | str |
| has_type | Concept | str |
| has_description | Thing | str |

### 实例统计

- LandUse 大类: 23 个（耕地、园地、林地、草地...）
- LandUse 中类: 18 个（水田、水浇地、旱地、果园...）
- Concept: 12 个（城镇开发边界、容积率、居住用地...）
- **总计: 51 实例**

### 关系统计

| 关系 | 数量 | 示例 |
|------|------|------|
| BELONGS_TO | 21 | 水田→耕地, 容积率→城镇开发边界 |
| GOVERNS | 3 | 生态保护红线→永久基本农田 |
| CONSTRAINS | 2 | 城镇开发边界→居住用地 |
| REFERENCES | 1 | 多规合一→用途管制 |
| **合计** | **27** | — |

## 文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `ml-service/scripts/build_ontology.py` | 新增 | 构建 OWL 本体（10 类、51 实例、5 对象属性） |
| `ml-service/scripts/run_reasoning.py` | 新增 | HermiT 推理 + 写回 Neo4j |
| `ml-service/output/geo_planning.owl` | 产物 | OWL 本体文件（自动生成，20KB） |
| `ml-service/output/ontology_report.txt` | 产物 | 本体结构报告 |
| `ml-service/server.py` | 改动 | 新增 3 个端点 |

## Flask 端点

| 端点 | 方法 | 用途 | 请求体 |
|------|------|------|--------|
| `/ontology/status` | GET | 本体状态（类/实例/属性数量） | — |
| `/ontology/reason` | POST | 运行 HermiT 推理，返回所有关系 | — |
| `/ontology/query` | POST | 按实体名查询关系 | `{"entity": "水田"}` |

### 响应示例

**GET /ontology/status**
```json
{
  "status": "ok",
  "classes": 10,
  "individuals": 51,
  "object_properties": 5,
  "class_names": ["LandUse", "Concept", "Document", ...]
}
```

**POST /ontology/query**
```json
{
  "entity": "水田",
  "classes": ["LandUseMinor"],
  "relations": [
    {"from": "水田", "relation": "BELONGS_TO", "to": "耕地"}
  ]
}
```

## 与问答链路的集成

后端 `kg.ts` 的 `MATCH (n)-[r]->(m)` 查询**不限定关系类型**，推理写入的 `INFERRED_RELATED` 关系会被自动消费——后端零改动。

## 使用方式

```bash
# 1. 构建本体（首次或数据更新后）
python scripts/build_ontology.py

# 2. 运行推理 + 写回 Neo4j（需 Neo4j 在线）
python scripts/run_reasoning.py

# 3. Flask 端点（需 server.py 运行）
curl http://localhost:5000/ontology/status
curl -X POST http://localhost:5000/ontology/query -H "Content-Type: application/json" -d '{"entity": "水田"}'
```

## 依赖

- `owlready2` (已安装, v0.51) — OWL 解析 + HermiT 推理机
- Java（HermiT 依赖）— 已有则无需额外安装

## 后续扩展

- 从 Neo4j 动态导入更多实例（当前硬编码 51 个）
- 推理结果持久化到 Neo4j（当前 Neo4j 不在线时保存在 OWL 文件中）
- 地质领域本体迁移（换语料 + 换标签体系，脚本结构不变）
