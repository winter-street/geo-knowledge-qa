"""
extract_concepts.py 的 TDD 测试
验证：文本分段、prompt 构建、结果去重（不依赖真实 LLM API）
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_split_sections():
    """测试文本分段"""
    from scripts.extract_concepts import split_into_sections

    text = ("第一章 地质背景\n\n"
            "第一条 演示矿物赋存于演示岩体中，需要开展详细研究。"
            "第二条 演示构造控制了区域内的矿化分布。"
            "\n\n第二章 成矿作用\n\n"
            "第三条 演示矿物形成于演示地质年代。")
    sections = split_into_sections(text, min_chars=20, max_chars=500)

    assert len(sections) >= 1, "应至少有一个分段"
    for s in sections:
        assert len(s) > 0, "分段不应为空"
        assert isinstance(s, str)

    print(f"[PASS] sections: {len(sections)}")
    for i, s in enumerate(sections):
        print(f"  section[{i}]: {len(s)} chars - {s[:60]}...")
    return True


def test_build_prompt():
    """测试 prompt 构建"""
    from scripts.extract_concepts import build_extraction_prompt

    prompt = build_extraction_prompt("测试文本段落内容")
    assert "地质找矿" in prompt, "prompt 应包含角色设定"
    assert "测试文本段落内容" in prompt, "prompt 应包含输入文本"
    assert "JSON" in prompt, "prompt 应要求 JSON 输出"
    assert "concepts" in prompt, "prompt 应提及 concepts"
    assert "relations" in prompt, "prompt 应提及 relations"

    print(f"[PASS] prompt length: {len(prompt)} chars")
    print(f"[PASS] prompt preview: {prompt[:200]}...")
    return True


def test_parse_llm_response():
    """测试 LLM 响应解析"""
    from scripts.extract_concepts import parse_llm_response

    # 正常 JSON
    resp = '{"concepts":[{"name":"演示矿物","type":"Mineral","description":"..."}],"relations":[]}'
    result = parse_llm_response(resp)
    assert len(result["concepts"]) == 1
    assert result["concepts"][0]["name"] == "演示矿物"
    assert len(result["relations"]) == 0

    # JSON in code block
    resp2 = '```json\n{"concepts":[],"relations":[]}\n```'
    result2 = parse_llm_response(resp2)
    assert result2["concepts"] == []
    assert result2["relations"] == []

    print("[PASS] normal JSON parsed")
    print("[PASS] code-block JSON parsed")
    return True


def test_deduplicate():
    """测试去重合并"""
    from scripts.extract_concepts import merge_results

    results = [
        {"concepts": [
            {"name": "演示矿物", "type": "Mineral", "description": "a"},
            {"name": "演示岩体", "type": "Rock", "description": "b"},
        ], "relations": [
            {"from": "演示矿物", "relation": "HOSTED_IN", "to": "演示岩体"},
        ]},
        {"concepts": [
            {"name": "演示矿物", "type": "Mineral", "description": "c"},
            {"name": "演示构造", "type": "Structure", "description": "d"},
        ], "relations": [
            {"from": "演示矿物", "relation": "HOSTED_IN", "to": "演示岩体"},
            {"from": "演示矿物", "relation": "CONTROLLED_BY", "to": "演示构造"},
        ]},
    ]

    merged = merge_results(results)

    # 概念去重（同名合并）
    concept_names = [c["name"] for c in merged["concepts"]]
    assert concept_names == ["演示矿物", "演示岩体", "演示构造"], f"去重后应为 3 个概念: {concept_names}"

    # 关系去重
    assert len(merged["relations"]) == 2, "应有 2 条去重关系"

    print(f"[PASS] concepts: {[c['name'] for c in merged['concepts']]}")
    print(f"[PASS] relations: {len(merged['relations'])}")
    return True


if __name__ == "__main__":
    test_split_sections()
    test_build_prompt()
    test_parse_llm_response()
    test_deduplicate()
