"""
LLM 辅助命名实体标注 — 用 DeepSeek API 对规划文本做 BIO 格式 NER 标注
产出 BERT-NER 微调所需的训练数据
"""
import requests
import json
import time

# 实体类型定义
ENTITY_TYPES = {
    "Mineral": "矿产名称（如钒钛磁铁矿、钛铁矿、黄铜矿、铅锌矿）",
    "Rock": "岩石名称（如辉长岩、玄武岩、花岗岩、石灰岩）",
    "Structure": "地质构造（如断裂带、褶皱、韧性剪切带、背斜）",
    "TimePeriod": "地质年代（如二叠纪、燕山期、侏罗纪、白垩纪）",
    "DepositType": "矿床成因类型（如岩浆分异型、热液充填型、沉积变质型）",
}


def build_ner_prompt(text: str) -> str:
    """
    构建 NER 标注 prompt，要求 LLM 按 BIO 格式输出。

    Args:
        text: 待标注的中文文本（建议 50-200 字）

    Returns:
        prompt 字符串
    """
    type_desc = "\n".join(f"- {t}: {desc}" for t, desc in ENTITY_TYPES.items())
    return f"""你是一位地质找矿领域的 NER 标注专家。请对以下文本进行命名实体识别，输出 BIO 格式。

## 实体类型定义
{type_desc}

## BIO 标注格式
每行一个字符：`字符 B-类型` 或 `字符 I-类型` 或 `字符 O`
- B-X: 实体开始（Begin）
- I-X: 实体内部（Inside）
- O: 非实体（Outside）

## 示例
输入: 尾亚钒钛磁铁矿赋存在二叠纪辉长岩中受断裂带控制
输出:
尾 B-Mineral
亚 I-Mineral
钒 I-Mineral
钛 I-Mineral
磁 I-Mineral
铁 I-Mineral
矿 I-Mineral
赋 O
存 O
在 O
二 B-TimePeriod
叠 I-TimePeriod
纪 I-TimePeriod
辉 B-Rock
长 I-Rock
岩 I-Rock
中 O
受 O
断 B-Structure
裂 I-Structure
带 I-Structure
控 O
制 O

## 待标注文本
{text}

请直接输出 BIO 标注结果，每行一个字符，不要输出任何其他内容。注意中文分词：每个汉字单独一行，标点符号也需要标注（标点标注为 O）。"""


def parse_bio_response(raw: str) -> list:
    """
    解析 LLM 返回的 BIO 标注，返回句子列表。

    Args:
        raw: LLM 原始返回文本

    Returns:
        [[(char, tag), ...], ...]  每个句子是一个列表
    """
    sentences = []
    current = []
    for line in raw.strip().split("\n"):
        line = line.strip()
        if not line:
            if current:
                sentences.append(current)
                current = []
            continue
        parts = line.split()
        if len(parts) >= 2:
            char = parts[0]
            # 取最后一个空格分隔的 token 作为标签
            tag = parts[-1]
            # 验证标签格式
            if tag == "O" or tag.startswith("B-") or tag.startswith("I-"):
                current.append((char, tag))
            else:
                current.append((char, "O"))
        elif len(parts) == 1:
            current.append((parts[0], "O"))
    if current:
        sentences.append(current)
    return sentences


def bio_to_conll(sentences: list) -> str:
    """
    将 BIO 标注转换为 CONLL 格式（BERT-NER 训练标准格式）。

    Args:
        sentences: [[(char, tag), ...], ...]

    Returns:
        CONLL 格式字符串（句间空行分隔）
    """
    lines = []
    for sent in sentences:
        for char, tag in sent:
            lines.append(f"{char} {tag}")
        lines.append("")  # 句间空行
    return "\n".join(lines).strip()


def annotate_text(text: str, llm_config: dict) -> list:
    """
    调用 DeepSeek API 对文本进行 NER 标注。

    Args:
        text: 待标注文本
        llm_config: LLM API 配置

    Returns:
        [(char, tag), ...] 句子级 BIO 标注
    """
    prompt = build_ner_prompt(text)

    resp = requests.post(
        f"{llm_config['base_url']}/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {llm_config['api_key']}",
        },
        json={
            "model": llm_config["model"],
            "messages": [
                {"role": "system", "content": "你是一个精确的 NER 标注器。严格按 BIO 格式输出，每行一个字符。只输出标注结果，不输出其他任何内容。"},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.0,
            "max_tokens": 4096,
        },
        timeout=90,
    )

    if resp.status_code != 200:
        raise RuntimeError(f"API 错误 {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    raw = data["choices"][0]["message"]["content"]
    return parse_bio_response(raw)


if __name__ == "__main__":
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from config import LLM_CONFIG
    from parse_pdf import parse_pdf

    # 取编制指南前 200 字做标注测试
    pdf_path = "D:/1GISwork/6-GISdevelop/data/samples/202009-自资部-市级国土空间总体规划编制指南（试行）（自然资办发[2020]46号）.pdf"
    parsed = parse_pdf(pdf_path)
    # 取一段有意义的内容
    text = ""
    for p in parsed["pages"][6:10]:
        text += p["text"]
    sample = text[:300]

    print("=== 待标注文本 ===")
    print(sample)
    print("\n=== LLM 标注中... ===")
    sentences = annotate_text(sample, LLM_CONFIG)
    print(f"\n实体数: {sum(1 for s in sentences for c, t in s if t != 'O')}")
    print("\n=== BIO 标注结果 ===")
    for sent in sentences:
        for char, tag in sent:
            if tag != "O":
                print(f"  {char} {tag}")
    print("\n=== CONLL 格式 ===")
    print(bio_to_conll(sentences))
