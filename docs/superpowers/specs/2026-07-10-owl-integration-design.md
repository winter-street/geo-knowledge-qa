# OWL 本体推理 — 管线集成设计

> **日期:** 2026-07-10 | **角色:** C（Python 预处理）| **状态:** 设计

**目标:** 把 OWL 本体推理模块接入预处理管线，上传新 PDF 后自动从 Neo4j 读取地质实体重建本体、运行 HermiT 推理、推理结果写回 Neo4j。

---

## 当前状态

| 文件 | 问题 |
|------|------|
| `build_ontology.py` | 数据全部硬编码（LandUse/Concept），Neo4j 导入是死代码 |
| `run_reasoning.py` | 不区分显式/推理关系，一股脑全返回 |
| `run_pipeline.py` | 没有调用 OWL 模块 |
| 管线 Step 5 之后 | 无本体推理步骤 |

## 设计

### 1. `build_ontology.py` — 从 Neo4j 动态建地质本体

**数据来源变更：**

```
旧: LANDUSE_MAJOR, LANDUSE_MINOR, CONCEPTS, CONCEPT_RELATIONS (硬编码)
新: MATCH (n) RETURN labels(n), properties(n)  +  MATCH ()-[r]->() RETURN type(r), ...
```

**OWL 类设计（地质域）：**

| OWL Class | Neo4j Label | 说明 |
|-----------|------------|------|
| `Mineral` | `Mineral` | 矿产实体 |
| `Rock` | `Rock` | 岩石实体 |
| `Structure` | `Structure` | 构造实体 |
| `TimePeriod` | `TimePeriod` | 地质年代 |
| `DepositType` | `DepositType` | 矿床成因类型 |
| `Document` | `Document` | 文献（已存在） |
| `GeoEntity` | — | 抽象父类，各实体类的父类 |

**OWL 对象属性（映射 Neo4j 关系类型）：**

```
HOSTED_IN, CONTROLLED_BY, FORMED_IN, BELONGS_TO,
ASSOCIATED_WITH, CUTS, REFERENCES, INFERRED_RELATED
```
- `BELONGS_TO` 设为 `transitive = True`（传递性推理：岩石属于二叠纪，矿产赋存于岩石 → 矿产形成于二叠纪）
- `CONTROLLED_BY` 设为 `transitive = True`

**函数签名：**
```python
def build_ontology() -> dict:
    """从 Neo4j 读取地质实体 + 关系，动态构建 OWL 本体。
    需要 Neo4j 在线（通过 config.NEO4J_CONFIG 连接）。
    如果 Neo4j 不可用，跳过本体构建，返回 error 状态。
    返回: {"classes": N, "individuals": N, "properties": N}
    """
```

**数据流：**
```
Neo4j: MATCH (n) RETURN labels(n), n.name, n.description
       MATCH (a)-[r]->(b) RETURN a.name, type(r), b.name
  ↓
owlready2: 创建 Class(Mineral), Class(Rock), ...
           创建 Individual(钒钛磁铁矿, Mineral)
           创建 ObjectProperty(HOSTED_IN)
           断言: 钒钛磁铁矿 HOSTED_IN 辉长岩
  ↓
保存: output/geo_planning.owl
```

### 2. `run_reasoning.py` — 只提取推理关系

**关键改动：区分显式关系和推理关系。**

HermiT 推理后，用 `sync_reasoner()` 前记录已断言的关系集合，推理后取差集：

```python
# 推理前：记录显式关系
explicit = set()
for prop in onto.object_properties():
    for s, o in prop.get_relations():
        explicit.add((s.name, prop.name, o.name))

# 推理后
sync_reasoner()

# 推理后：取差集 = 推理出的新关系
for prop in onto.object_properties():
    for s, o in prop.get_relations():
        key = (s.name, prop.name, o.name)
        if key not in explicit:
            inferred.append(key)
```

**写回 Neo4j：** 每条推理关系以原有关系类型写入（不做 INFERRED_RELATED 一刀切），加属性 `inferred: true`：

```cypher
MATCH (a {name: $from})
MATCH (b {name: $to})
MERGE (a)-[:FORMED_IN {display: $display, inferred: true}]->(b)
```

**返回值：**
```python
def run_reasoning(owl_path=None, write_to_neo4j=True) -> dict:
    """返回: {"explicit": N, "inferred": N, "relations": [...]}
    """
```

### 3. `run_pipeline.py` — Step 6 本体推理

在 Step 5（写入 Neo4j）之后，Step 总结之前，新增：

```python
# ---- Step 6: OWL 本体推理 ----
step("Step 6/6: OWL 本体推理")

from build_ontology import build_ontology
from run_reasoning import run_reasoning

onto_stats = build_ontology()
reason_stats = run_reasoning(write_to_neo4j=True)

print(f"  本体: {onto_stats['classes']} 类, {onto_stats['individuals']} 实例")
print(f"  显式关系: {reason_stats['explicit']}")
print(f"  推理关系: {reason_stats['inferred']}")
```

- 全量模式：重建本体 + 推理
- 增量模式（上传）：从 Neo4j 重读最新数据 → 重建本体 → 推理，结果 MERGE 写入
- `--from-step4`：同样跑（Step 5 之后数据已更新）
- **容错**：Neo4j 不可用或 HermiT 推理失败时，打印警告跳过，不影响 Steps 1-5 的产出

### 4. 输出物

| 产物 | 说明 |
|------|------|
| `output/geo_planning.owl` | 地质域 OWL 本体（每次重建） |
| `output/ontology_report.txt` | 本体构建报告 |
| Neo4j 推理边 | `inferred: true` 标记的关系 |

---

## 验证

1. 跑 `--from-step4`，确认 Step 6 输出 `推理关系 > 0`
2. Neo4j:
   ```cypher
   MATCH ()-[r]->() WHERE r.inferred = true RETURN count(r)
   ```
   应 > 0
3. `http://localhost:5000/ontology/status` 返回地质类名（Mineral/Rock/...）
