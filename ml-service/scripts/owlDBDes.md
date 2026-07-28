# 地质找矿知识图谱本体库设计说明

> 本体库位置：`ml-service/output/geo_planning.owl`（4137 行，RDF/XML 格式）
> 构建脚本：`ml-service/scripts/build_ontology.py` · 推理脚本：`ml-service/scripts/run_reasoning.py`
> Neo4j 源：6 类节点 444 实例 · 8 种关系类型 · 推理机：HermiT + BFS 传递闭包

---

## 一、本体概述

**命名空间**：`http://geo-knowledge.edu.cn/geology#`

**OWL 版本**：OWL 2 RL（符合 W3C 标准）

**推理机**：HermiT（基于 Tableau 算法的 OWL 2 DL 推理器）+ BFS 传递闭包

**构建方式**：从 Neo4j 知识图谱动态读取地质实体与关系，自动生成 OWL 本体文件。Neo4j 数据更新后，重新运行 `build_ontology.py` + `run_reasoning.py` 即可刷新本体。

---

## 二、类层级（Class Hierarchy）

采用多层地质学分类体系，共 7 大类 × 30+ 子类：

```
Thing
 └── GeoEntity （地质实体，抽象父类）
      │
      ├── Mineral （矿产）
      │     └── MetallicMineral （金属矿产）
      │           ├── FerrousMetal （黑色金属）
      │           │     └── 铁矿 / 锰矿 / 铬铁矿 / 钒钛磁铁矿 ...
      │           ├── NonFerrousMetal （有色金属）
      │           │     └── 铜矿 / 铅锌矿 / 金矿 / 镍矿 / 锡矿 ...
      │           └── PreciousMetal （贵金属）
      │
      ├── Rock （岩石）
      │     ├── IgneousRock （岩浆岩）
      │     ├── SedimentaryRock （沉积岩）
      │     └── MetamorphicRock （变质岩）
      │
      ├── Structure （构造）
      │     ├── Fault （断裂）
      │     ├── Fold （褶皱）
      │     └── TectonicZone （构造混杂岩带/缝合带/俯冲带）
      │
      ├── TimePeriod （地质年代）
      │     ├── Eon （宙）
      │     ├── Era （代）
      │     ├── Period （纪）
      │     ├── Epoch （世）
      │     └── AgeStage （期/阶）
      │
      ├── DepositType （矿床成因类型）
      │     ├── MagmaticDeposit （岩浆矿床）
      │     ├── HydrothermalDeposit （热液矿床）
      │     ├── SedimentaryDeposit （沉积矿床）
      │     └── MetamorphicDeposit （变质矿床）
      │
      ├── Document （文献资料）
      │
      └── Region （空间区域）
```

### 类定义依据

| 分类体系 | 依据标准 |
|---------|---------|
| 岩石三大类 | 地质学基础分类（岩浆岩/沉积岩/变质岩） |
| 矿产三分类 | 全国矿产资源分类方案（黑色/有色/贵金属） |
| 矿床成因四类 | 矿床学经典分类（岩浆/热液/沉积/变质） |
| 年代五级 | 国际地层委员会 ICS 年代地层表（宙/代/纪/世/期） |
| 构造三子类 | 地质构造学基础分类 |

---

## 三、对象属性（Object Properties）

7 种地质关系，均定义了 domain/range 约束和传递性：

| 属性 | 中文名 | Domain | Range | 传递性 | 逆属性 | 地质含义 |
|------|--------|--------|-------|:---:|--------|---------|
| `HOSTED_IN` | 赋存于 | Mineral | Rock | — | `HOSTS` | 矿产赋存在宿主岩石中 |
| `CONTROLLED_BY` | 受控于 | Mineral, Rock | Structure | ✓ | `CONTROLS` | 矿产/岩石分布受构造控制 |
| `FORMED_IN` | 形成于 | Mineral | TimePeriod | — | `WITNESSED` | 成矿时代 |
| `BELONGS_TO` | 属于 | Rock, Structure, TimePeriod | TimePeriod | ✓ | `CONTAINS` | 地层层序 / 年代归属 |
| `ASSOCIATED_WITH` | 共生伴生 | Mineral, Rock | Mineral, Rock | — | — | 矿物共生组合关系 |
| `CUTS` | 切穿 | Structure | Rock | — | `CUT_BY` | 构造穿插岩石 |
| `REFERENCES` | 引用 | Document | GeoEntity | — | `REFERENCED_BY` | 文献溯源 |

### 传递性说明

- **BELONGS_TO 传递性**：早二叠世→二叠纪→古生代→显生宙，推理机自动补全跨级关系，查询"古生代矿产"时会自动包含二叠纪/石炭纪/泥盆纪...所有子级矿产。
- **CONTROLLED_BY 传递性**：某矿产受控于某断裂带→该断裂带属于某造山带，推理出矿产与上级构造单元的控制关系。

---

## 四、数据属性（Data Property）

| 属性 | 类型 | 说明 |
|------|------|------|
| `has_description` | xsd:string | 实体描述文本（来源于 Neo4j description 属性） |

---

## 五、成矿规律推理规则（SWRL 语义规则）

本体定义了 4 条成矿推理规则，由 HermiT 推理机执行：

### 规则 1：基性-超基性岩赋存钒钛磁铁矿
```
若: ?m 是 Mineral ∧ ?r 是 IgneousRock ∧ ?m HOSTED_IN ?r
    ∧ ?r 属于基性超基性岩类（辉长岩/橄榄岩/辉石岩/超镁铁岩）
则: 推断 ?m 成因类型 = "岩浆分异型"
```

### 规则 2：断裂带控矿规律
```
若: ?m 是 Mineral ∧ ?s 是 Fault ∧ ?m CONTROLLED_BY ?s
    ∧ ?m HOSTED_IN ?r ∧ ?r 属于 IgneousRock
则: 推断 ?m 矿床类型 = "岩浆分异-贯入-热液型"
```

### 规则 3：接触变质成矿
```
若: ?m 是 Mineral ∧ ?r 是 IgneousRock ∧ ?s 是 MetamorphicRock
    ∧ ?m HOSTED_IN ?r ∧ ?s CUT_BY ?r
则: 推断 ?m 成因类型 = "接触变质型"
```

### 规则 4：地质年代成矿专属性
```
若: ?m HOSTED_IN ?r ∧ ?r BELONGS_TO ?t ∧ ?t 是 晚古生代
则: 推断 ?m FORMED_IN 晚古生代
```

---

## 六、推理能力对比

| 推理类型 | 原方案 | 改造后 |
|---------|--------|--------|
| 传递闭包（BELONGS_TO） | ✓ BFS | ✓ BFS + HermiT |
| 传递闭包（CONTROLLED_BY） | ✓ BFS | ✓ BFS + HermiT |
| 类层级推理（子类继承父类关系） | ✗ | ✓ HermiT |
| 领域/值域约束验证 | ✗ | ✓ HermiT |
| SWRL 成矿规则 | ✗ | ✓ HermiT |
| 逆属性自动推导 | ✗ | ✓ owlready2 |

### 推理效果示例

| 用户查询 | 原方案结果 | 改造后结果 |
|---------|-----------|-----------|
| "中生代的矿产" | 仅直接关联的实体 | 自动包含侏罗纪+白垩纪全部矿产 |
| "岩浆矿床有哪些" | 无法回答（DepositType 无层级） | 自动汇总所有子类实例 |
| "基性岩里的铁矿" | 靠 LLM 推理 | 本体推理给出完整列表 + 成因解释 |
| "显生宙的构造活动" | 查不到跨级关系 | 传递闭包覆盖全部子年代 |

---

## 七、与系统其他模块的关系

```
┌──────────────────────────────────────────────────────────────────┐
│                    问答全链路中的本体位置                           │
│                                                                   │
│  PDF 地质报告                                                      │
│       │                                                           │
│       ▼                                                           │
│  extract_hybrid.py ──→ Neo4j 知识图谱（显式知识）                   │
│       │                       │                                   │
│       │                       ▼                                   │
│       │              build_ontology.py ──→ geo_planning.owl       │
│       │                       │              （形式化本体）          │
│       │                       ▼                                   │
│       │              run_reasoning.py ──→ Neo4j（推理知识）         │
│       │                       │              inferred: true        │
│       │                       ▼                                   │
│       │              backend kg.ts ──→ 三路检索中的 KG 路径         │
│       │                       │                                   │
│       ▼                       ▼                                   │
│  Flask :5000 /search ──→ LLM Gateway ──→ 前端问答 + 溯源          │
│  （RAG 检索）              （整合 RAG+KG+空间）                      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 八、规模统计

| 指标 | 数值 |
|------|:---:|
| 本体文件大小 | 4137 行 RDF/XML |
| 顶层类 | 1（GeoEntity） |
| 实体子类 | 7 个直接子类 + 22 个细分地质子类 |
| 实体实例 | 444 个（来源于 Neo4j） |
| 对象属性 | 7 种（均含 domain/range 约束） |
| 逆属性 | 6 种 |
| 传递性属性 | 2 种（BELONGS_TO / CONTROLLED_BY） |
| 数据属性 | 1 种（has_description） |
| SWRL 成矿规则 | 4 条 |
| 显式关系（Neo4j 来源） | ~500 条 |
| 推理新增关系 | ~200 条（传递闭包 + 类层级推理） |

---

## 九、设计原则

| 原则 | 说明 |
|------|------|
| **Neo4j 为源** | 本体不从零手写，从 Neo4j 动态生成，保证数据一致性 |
| **动态刷新** | Neo4j 更新后，运行 build → reason 两脚本即刷新本体 |
| **可解释性** | 推理关系标记 `inferred: true`，前端可区分"直接提取"与"逻辑推导" |
| **标准兼容** | OWL 2 RL 标准格式，可用 Protégé 等标准工具打开和编辑 |
| **可扩展** | 新增实体类型/关系类型只需修改脚本常量，自动映射到 OWL |

---

## 十、后续扩展方向

1. **补全前寒武纪年代层级**：当前 ERA_HIERARCHY 仅覆盖显生宙，太古代/元古代的纪/世关系待补
2. **沉积岩/变质岩细分**：砂岩→石英砂岩/长石砂岩，片麻岩→斜长片麻岩/黑云斜长片麻岩
3. **成矿带空间本体**：昆仑成矿带/天山成矿带的空间隶属关系编码为 LIES_IN 层级
4. **更多 SWRL 规则**：矽卡岩型成矿规律、斑岩型铜矿识别、沉积变质型铁矿规律
5. **与外部标准对齐**：GeoSciML 地质数据交换标准、CGI 国际地学本体
