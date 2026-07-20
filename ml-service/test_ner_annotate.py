"""
TDD 测试：LLM 辅助命名实体标注（NER annotation）
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_build_ner_prompt():
    """测试 NER 标注 prompt 构建"""
    from scripts.ner_annotate import build_ner_prompt

    text = "演示矿物赋存于演示岩体中，并受演示构造控制。"
    prompt = build_ner_prompt(text)

    assert text in prompt, "prompt 应包含输入文本"
    for entity_type in ["Mineral", "Rock", "Structure", "TimePeriod", "DepositType"]:
        assert entity_type in prompt, f"prompt 应定义 {entity_type} 标签"
    assert "BIO" in prompt or "B-" in prompt, "prompt 应说明 BIO 标注格式"
    assert len(prompt) > 200, "prompt 应该足够详细"

    print(f"[PASS] prompt length: {len(prompt)}")
    print(f"[PASS] prompt preview: {prompt[:200]}...")
    return True


def test_parse_bio_response():
    """测试 BIO 格式响应解析"""
    from scripts.ner_annotate import parse_bio_response

    # 模拟 LLM 返回的 BIO 标注
    raw = """矿 B-Mineral
物 I-Mineral
赋 O
存 O
于 O
岩 B-Rock
体 I-Rock
中 O
受 O
构 B-Structure
造 I-Structure
控 O
制 O
。 O"""

    sentences = parse_bio_response(raw)

    # 应该解析出 2 个实体
    entities = sentences[0] if isinstance(sentences[0], list) else sentences
    assert len(entities) > 0, f"应解析出至少一个实体: {entities}"

    print(f"[PASS] parsed entities: {entities}")
    return True


def test_convert_to_conll():
    """测试 BIO 格式转 CONLL 格式"""
    from scripts.ner_annotate import bio_to_conll

    bio_sentences = [
        [("矿", "B-Mineral"), ("物", "I-Mineral"), ("赋", "O"), ("存", "O")],
        [("岩", "B-Rock"), ("体", "I-Rock"), ("中", "O")],
    ]

    conll = bio_to_conll(bio_sentences)
    lines = conll.strip().split("\n")

    assert len(lines) >= 4, f"至少应有 4 行: {lines}"
    assert "B-Mineral" in conll
    assert "B-Rock" in conll
    assert "-DOCSTART-" not in conll.split("\n")[0]  # 第一行是数据不是元数据

    print(f"[PASS] CONLL output ({len(lines)} lines):")
    print(conll[:300])
    return True


if __name__ == "__main__":
    test_build_ner_prompt()
    test_parse_bio_response()
    test_convert_to_conll()
