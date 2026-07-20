"""
TDD：LandUse-Concept 桥接——把两棵树连上线
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_find_matches():
    """测试关键词匹配找到 LandUse-Concept 关联"""
    from scripts.bridge_landuse_concept import find_matches

    landuse = [
        {"name": "湿地", "code": "05", "level": "大类"},
        {"name": "森林沼泽", "code": "0501", "level": "中类"},
        {"name": "工业用地", "code": "1001", "level": "中类"},
    ]
    concepts = [
        {"name": "生态保护红线", "type": "空间管控"},
        {"name": "湿地保护", "type": "政策要求"},
        {"name": "工业用地布局", "type": "规划指标"},
    ]

    matches = find_matches(landuse, concepts)

    assert len(matches) > 0, f"应有匹配: {matches}"

    # "湿地" 包含于 "湿地保护"
    wetland_match = any(
        m["landuse_name"] == "湿地" and "湿地" in m["concept_name"]
        for m in matches
    )
    assert wetland_match, "'湿地'应匹配'湿地保护'"

    # "工业用地" 含于 "工业用地布局"（直接包含）
    industry_match = any(
        m["landuse_name"] == "工业用地" and "工业用地" in m["concept_name"]
        for m in matches
    )
    assert industry_match, "'工业用地'应匹配'工业用地布局'"

    print(f"[PASS] matches: {len(matches)}")
    for m in matches:
        print(f"  {m['landuse_name']} ←→ {m['concept_name']} ({m['reason']})")
    return True


def test_bridge_quality():
    """测试桥接质量：匹配不应该太宽泛"""
    from scripts.bridge_landuse_concept import find_matches

    # "耕地" 不应该匹配到完全不相关的概念
    landuse = [{"name": "耕地", "code": "01"}]
    concepts = [{"name": "容积率", "type": "规划指标"}]

    matches = find_matches(landuse, concepts)
    assert len(matches) == 0, f"耕地和容积率不应该匹配: {matches}"

    print("[PASS] no false matches")
    return True


if __name__ == "__main__":
    test_find_matches()
    test_bridge_quality()
