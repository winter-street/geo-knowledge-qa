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

    text = ("第一章 总则\n\n"
            "第一条 这是关于国土空间规划的重要内容，需要详细阐述。"
            "第二条 更多关于规划编制和实施管理的具体规定。"
            "\n\n第二章 规划\n\n"
            "第三条 规划内容涉及城镇开发边界和生态保护红线的划定。")
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
    assert "国土空间规划" in prompt, "prompt 应包含角色设定"
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
    resp = '{"concepts":[{"name":"城镇开发边界","type":"空间管控","description":"..."}],"relations":[]}'
    result = parse_llm_response(resp)
    assert len(result["concepts"]) == 1
    assert result["concepts"][0]["name"] == "城镇开发边界"
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
            {"name": "城镇开发边界", "type": "空间管控", "description": "a"},
            {"name": "容积率", "type": "规划指标", "description": "b"},
        ], "relations": [
            {"from": "城镇开发边界", "relation": "GOVERNS", "to": "容积率"},
        ]},
        {"concepts": [
            {"name": "城镇开发边界", "type": "空间管控", "description": "c"},
            {"name": "建筑密度", "type": "规划指标", "description": "d"},
        ], "relations": [
            {"from": "城镇开发边界", "relation": "GOVERNS", "to": "容积率"},
            {"from": "城镇开发边界", "relation": "GOVERNS", "to": "建筑密度"},
        ]},
    ]

    merged = merge_results(results)

    # 概念去重（同名合并）
    concept_names = [c["name"] for c in merged["concepts"]]
    assert concept_names == ["城镇开发边界", "容积率", "建筑密度"], f"去重后应为 3 个概念: {concept_names}"

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
