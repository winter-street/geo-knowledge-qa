"""
词典标注地质NER训练数据（同国土版 F1=0.99 方案）
Neo4j 实体名 → PDF原文扫描 + 构造句 → 精确BIO → ner_final.conll
"""
import os, sys, re
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))
from neo4j import GraphDatabase
from parse_pdf import parse_pdf
from config import PDF_FILES, NEO4J_CONFIG
try:
    from entity_quality import validate_entity
except ModuleNotFoundError:
    from scripts.entity_quality import validate_entity

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "output")

# 实体类型 → Neo4j 标签
LABEL_MAP = {
    "Mineral": "Mineral", "Rock": "Rock", "Structure": "Structure",
    "TimePeriod": "TimePeriod", "DepositType": "DepositType",
}


def hardcoded_entities():
    """硬编码地质年代 + 矿床类型（补 Neo4j 词典覆盖不足）"""
    time_periods = [
        # 宙/代/纪/世
        "太古代", "元古代", "古生代", "中生代", "新生代", "显生宙",
        "寒武纪", "奥陶纪", "志留纪", "泥盆纪", "石炭纪", "二叠纪",
        "三叠纪", "侏罗纪", "白垩纪", "古近纪", "新近纪", "第四纪",
        "太古宙", "元古宙", "太古宇", "元古宇",
        # 期
        "燕山期", "喜山期", "加里东期", "海西期", "印支期", "晋宁期",
        # 世
        "早寒武世", "中寒武世", "晚寒武世", "早奥陶世", "中奥陶世", "晚奥陶世",
        "早志留世", "中志留世", "晚志留世", "早泥盆世", "中泥盆世", "晚泥盆世",
        "早石炭世", "晚石炭世", "早二叠世", "中二叠世", "晚二叠世",
        "早三叠世", "中三叠世", "晚三叠世", "早侏罗世", "中侏罗世", "晚侏罗世",
        "早白垩世", "晚白垩世", "古新世", "始新世", "渐新世", "中新世", "上新世", "更新世", "全新世",
        # 界/系/统
        "太古界", "元古界", "古生界", "中生界", "新生界",
        "寒武系", "奥陶系", "志留系", "泥盆系", "石炭系", "二叠系",
        "三叠系", "侏罗系", "白垩系", "古近系", "新近系", "第四系",
        "下奥陶统", "中奥陶统", "上奥陶统", "下石炭统", "上石炭统",
        "下二叠统", "中二叠统", "上二叠统", "下三叠统", "中三叠统", "上三叠统",
        "下侏罗统", "中侏罗统", "上侏罗统", "下白垩统", "上白垩统",
        # 纪/代简称
        "前寒武纪", "中元古代", "新元古代", "古元古代", "晚古生代", "早古生代",
        "下元古界", "中元古界", "上元古界", "下古生界", "上古生界",
        # 组/群（来自工作区报告）
        "杜瓦组", "龙山组", "埃连卡特岩群", "康西瓦岩群", "塞拉加兹塔格岩群",
        "博查特塔格岩群", "塔哈奇岩组", "赛力亚克达坂群",
    ]
    deposit_types = [
        # 岩浆类
        "岩浆型", "岩浆分异型", "岩浆熔离型", "岩浆分异-贯入-热液型",
        "岩浆分异-贯入-热液型复成因矿床", "岩浆结晶分异型", "岩浆晚期分异型",
        "岩浆贯入型", "岩浆热液型", "火山岩浆型", "基性超基性岩型",
        # 热液类
        "热液型", "热液充填型", "热液交代型", "中低温热液型", "高温热液型",
        "中温热液型", "低温热液型", "浅成低温热液型", "远成热液型",
        # 沉积类
        "沉积型", "沉积变质型", "化学沉积型", "生物沉积型", "火山沉积型",
        "海相沉积型", "陆相沉积型", "蒸发沉积型",
        # 变质类
        "变质型", "区域变质型", "接触变质型", "动力变质型",
        # 特定类型
        "矽卡岩型", "斑岩型", "玢岩型", "碳酸岩型", "金伯利岩型",
        "风化壳型", "残坡积型", "冲积型", "坡积型", "洪积型",
        "火山岩型", "火山喷发沉积型", "火山热液型",
        "伟晶岩型", "层控型", "构造蚀变岩型", "复成因矿床",
        "铜镍硫化物型", "铜镍硫化物矿床", "钒钛磁铁矿型",
        "攀枝花式", "大庙式", "尾亚式", "香山式",
        "VMS型", "SEDEX型", "MVT型", "IOCG型",
    ]
    d = {}
    for t in time_periods:
        d[t] = "TimePeriod"
    for t in deposit_types:
        d[t] = "DepositType"

    # 硬编码常见岩石/矿物/构造名（Neo4j 不在线时的后备）
    rocks = [
        "辉长岩", "玄武岩", "花岗岩", "闪长岩", "安山岩", "流纹岩", "橄榄岩", "辉石岩",
        "石灰岩", "白云岩", "砂岩", "页岩", "泥岩", "砾岩", "角砾岩",
        "大理岩", "片麻岩", "片岩", "板岩", "千枚岩", "石英岩", "变粒岩",
        "斜长片麻岩", "斜长变粒岩", "二云石英片岩", "石榴二云石英片岩",
        "黑云斜长片麻岩", "矽线黑云斜长变粒岩", "黑云石英片岩",
        "细粒长石石英砂岩", "粉砂质板岩", "绢云母板岩", "白云石大理岩",
        "紫红色砾岩", "石英粉砂岩", "泥灰岩", "含钙石英砂岩",
        "变质细粒石英砂岩", "变质中细粒长石砂岩", "深灰色粉砂质板岩",
        "石榴黑云斜长片麻岩", "石榴黑云斜长变粒岩", "十字石榴二云石英片岩",
        "斜长黑云石英片岩", "二云石英岩", "矽线黑云石英片岩",
        "灰色石榴斜长二云石英片岩", "黑云石英粒岩", "石榴矽线黑云石英岩",
        "碱性辉长岩", "碱性超镁铁质-镁铁质杂岩", "镁铁质岩石", "超镁铁岩",
    ]
    minerals = [
        "钒钛磁铁矿", "钛铁矿", "磁铁矿", "黄铜矿", "铅锌矿", "黄铁矿", "赤铁矿",
        "镁钛铁矿", "铬铁矿", "铜镍矿", "镍黄铁矿", "磁黄铁矿", "斑铜矿",
        "闪锌矿", "方铅矿", "辉锑矿", "锡石", "黑钨矿", "白钨矿", "辉钼矿",
        "钛磁铁矿", "钒矿", "钛矿", "铁矿", "铜矿", "金刚石",
    ]
    structures = [
        "断裂带", "褶皱", "背斜", "向斜", "韧性剪切带", "构造混杂岩带", "断隆带",
        "岩浆弧", "陆块", "造山带", "褶断带", "微陆块", "俯冲带", "缝合带",
        "逆冲推覆构造", "走滑断裂", "正断层", "逆断层", "平移断层",
        "韧性断层", "脆性断层", "断裂破碎带", "片理化带", "糜棱岩带",
        "阿尔金南缘断裂带", "柯岗断裂带", "康西瓦-苏巴什蛇绿构造混杂岩带",
        "塔里木陆块", "铁克里克断隆带", "西昆仑造山带", "西昆北岩浆弧",
        "西昆中微陆块", "西昆南俯冲增生杂岩带", "巴彦喀拉褶断带",
        "塔什库尔干-甜水海陆块", "明铁盖陆块",
        "东天山造山带", "香山西段断裂带", "尾亚断裂带",
        "库地-其曼于特蛇绿构造混杂岩带", "苏巴什-柳什塔格蛇绿构造混杂岩带",
        "康西瓦-木孜塔格构造混杂岩带", "乌恰-郭扎错构造混杂岩带", "塔阿西构造混杂岩带",
        "阿尔金断裂", "昆仑断裂", "康西瓦断裂",
        "柯岗断裂", "可可托海断裂", "阿尔金走滑断裂", "康西瓦走滑断裂",
        "大红山断裂", "柴达木北缘断裂", "东昆仑断裂带", "祁连山断裂带",
        "天山断裂带", "塔里木盆地北缘断裂", "阿尔泰断裂带",
        "额尔齐斯断裂带", "准噶尔断裂带", "伊犁盆地断裂",
    ]
    for t in rocks:
        if t not in d: d[t] = "Rock"
    for t in minerals:
        if t not in d: d[t] = "Mineral"
    for t in structures:
        if t not in d: d[t] = "Structure"
    return d


def load_entity_dict(driver):
    """从 Neo4j 加载所有地质实体名 → type，合并硬编码词典"""
    entities = hardcoded_entities()
    with driver.session() as s:
        for label in LABEL_MAP:
            result = s.run(f"MATCH (n:{label}) WHERE size(n.name) >= 2 RETURN n.name AS name")
            for r in result:
                validation = validate_entity(r["name"], label)
                if validation.valid:
                    # 硬编码词典优先（类型更准确）
                    if validation.name not in entities:
                        entities[validation.name] = label
    return entities


def text_to_sentences(text: str) -> list:
    """将文本按句号切分为句子列表"""
    sentences = []
    current = ""
    for ch in text.replace("\n", ""):
        current += ch
        if ch in "。！？；" and len(current) >= 5:
            sentences.append(current)
            current = ""
    if len(current) >= 5:
        sentences.append(current)
    return sentences


def build_regex_patterns(entity_dict: dict) -> dict:
    """为每种实体类型构建正则（长名优先，一次匹配全部）"""
    patterns = {}
    for etype in LABEL_MAP:
        names = sorted([n for n, t in entity_dict.items() if t == etype], key=len, reverse=True)
        if names:
            # 转义特殊字符，按长度降序拼接
            escaped = [re.escape(n) for n in names]
            patterns[etype] = re.compile("|".join(escaped))
    return patterns


def sentence_to_bio_regex(sentence: str, patterns: dict) -> list:
    """用预编译正则一次扫描全部实体 → BIO"""
    tags = ["O"] * len(sentence)
    for etype, pat in patterns.items():
        for m in pat.finditer(sentence):
            start, end = m.start(), m.end()
            if any(t != "O" for t in tags[start:end]):
                continue  # 已被更长实体占用
            tags[start] = f"B-{etype}"
            for j in range(start + 1, end):
                tags[j] = f"I-{etype}"
    return [(sentence[i], tags[i]) for i in range(len(sentence))]


def fabricated_sentences(entity_dict: dict, patterns: dict) -> list:
    """构造句：每个实体造短句，增加实体密度"""
    templates = [
        "{}是地质工作中常见的{}。",
        "研究区内{}广泛发育。",
        "该区域的{}分布较为集中。",
        "{}属于本区重要的地质单元。",
        "工作区出露{}地层。",
        "区内{}为主要含矿层位。",
        "{}岩体侵位于该区域。",
        "断裂带控制了{}的分布。",
    ]
    type_cn = {
        "Mineral": "矿产", "Rock": "岩石", "Structure": "构造",
        "TimePeriod": "地质年代", "DepositType": "矿床类型",
    }
    sentences = []
    for name, etype in entity_dict.items():
        if len(name) > 15:
            continue
        # 弱类略多：TimePeriod 3句, DepositType 3句, 其他 2句
        if etype in ("TimePeriod", "DepositType"):
            n_tmpl = 3
        else:
            n_tmpl = 2
        for k in range(n_tmpl):
            tmpl = templates[(hash(name) + k * 13) % len(templates)]
            text = tmpl.format(name, type_cn.get(etype, "类型"))
            bio = sentence_to_bio_regex(text, {etype: re.compile(re.escape(name))})
            if bio:
                sentences.append(bio)
    return sentences


def bio_to_conll(sentences: list) -> str:
    lines = []
    for sent in sentences:
        for char, tag in sent:
            lines.append(f"{char} {tag}")
        lines.append("")
    return "\n".join(lines).strip()


def main():
    print("=== 词典标注地质NER ===")

    # 0. 备份旧 LLM 数据
    old_conll = os.path.join(OUTPUT_DIR, "ner_final.conll")
    llm_backup = os.path.join(OUTPUT_DIR, "ner_llm_backup.conll")
    if os.path.exists(old_conll) and not os.path.exists(llm_backup):
        print(f"\n[0/5] 备份已有 conll → ner_llm_backup.conll")
        with open(old_conll, encoding="utf-8") as f:
            old = f.read()
        with open(llm_backup, "w", encoding="utf-8") as f:
            f.write(old)

    # 1. 连接 Neo4j，加载实体词典
    print("\n[1/5] 从 Neo4j 加载实体...")
    driver = GraphDatabase.driver(NEO4J_CONFIG["uri"],
                                   auth=(NEO4J_CONFIG["user"], NEO4J_CONFIG["password"]))
    entity_dict = load_entity_dict(driver)
    driver.close()
    print(f"  实体词典: {len(entity_dict)} 个")
    for t in LABEL_MAP:
        n = sum(1 for v in entity_dict.values() if v == t)
        print(f"    {t}: {n}")

    # 编译正则（一次，全文复用）
    print("\n[2/5] 编译正则 + PDF 原文扫描标注...")
    patterns = build_regex_patterns(entity_dict)
    print(f"  正则类型: {list(patterns.keys())}")

    all_sentences = []
    for pdf_info in PDF_FILES:
        name = os.path.basename(pdf_info["path"])[:40]
        try:
            doc = parse_pdf(pdf_info["path"])
        except Exception as e:
            print(f"  {name}: 解析失败 {e}")
            continue
        text = "".join(p["text"] for p in doc["pages"])[300:]
        sents = text_to_sentences(text)
        doc_entities = 0
        for sent in sents:
            bio = sentence_to_bio_regex(sent, patterns)
            if any(t != "O" for _, t in bio):
                all_sentences.append(bio)
                doc_entities += sum(1 for _, t in bio if t.startswith("B-"))
        print(f"  {name}: {len(sents)}句 → {doc_entities}实体")

    real_count = len(all_sentences)
    real_entities = sum(1 for s in all_sentences for _, t in s if t.startswith("B-"))
    print(f"  原文标注: {real_count}句, {real_entities}实体")

    # 3. 构造句
    print("\n[3/5] 构造句增强...")
    fab = fabricated_sentences(entity_dict, patterns)
    fab_entities = sum(1 for s in fab for _, t in s if t.startswith("B-"))
    print(f"  构造句: {len(fab)}句, {fab_entities}实体")

    # 4. 合并 LLM 标注数据（词典漏标的 LLM 补上）
    print("\n[4/5] 合并 LLM 标注数据...")
    all_s = all_sentences[:]  # 从原文标注开始
    llm_path = os.path.join(OUTPUT_DIR, "ner_llm_backup.conll")
    if os.path.exists(llm_path):
        with open(llm_path, encoding="utf-8") as f:
            llm_conll = f.read()
        # 解析
        llm_sents = []
        cur = []
        for line in llm_conll.split("\n"):
            line = line.strip()
            if not line:
                if cur: llm_sents.append(cur); cur = []
            else:
                parts = line.split()
                if len(parts) == 2: cur.append((parts[0], parts[1]))
        if cur: llm_sents.append(cur)
        # 只保留 LLM 数据中包含稀有类型实体的句子
        for s in llm_sents:
            types_in_s = set(t[2:] for _, t in s if t.startswith("B-"))
            if types_in_s & {"TimePeriod", "DepositType"}:
                all_s.append(s)
        print(f"  LLM补充(稀有类型): {len([s for s in llm_sents if any(t.startswith('B-') and t[2:] in ('TimePeriod','DepositType') for _,t in s)])}句")

    # 5. 去重 + 保存
    print("\n[5/5] 合并保存...")
    all_s = all_sentences + fab
    # 去重
    seen = set()
    deduped = []
    for s in all_s:
        key = "".join(c for c, t in s)
        if key and key not in seen:
            seen.add(key)
            deduped.append(s)

    conll = bio_to_conll(deduped)
    path = os.path.join(OUTPUT_DIR, "ner_final.conll")
    with open(path, "w", encoding="utf-8") as f:
        f.write(conll)

    b_count = sum(1 for l in conll.split("\n") if " B-" in l)
    print(f"\n  输出: {path}")
    print(f"  去重后: {len(deduped)}句, {b_count}实体")
    print(f"\n续跑: python scripts/prepare_ner_data.py && python scripts/train_ner.py && python scripts/eval_ner.py")


if __name__ == "__main__":
    main()
