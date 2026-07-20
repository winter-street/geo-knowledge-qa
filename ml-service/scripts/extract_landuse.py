"""
用地分类提取脚本 —— 正则匹配编码层级（大类/中类/小类）
从用地用海分类指南中提取分类体系
"""
import re


def extract_landuse(parsed_doc: dict) -> list:
    """
    从解析后的用地分类指南中提取分类节点。

    Args:
        parsed_doc: parse_pdf 输出

    Returns:
        [{name, code, level, parent_code}, ...]
        level: "大类" | "中类" | "小类"
    """
    # 拼接所有页的文本
    full_text = "\n".join(p["text"] for p in parsed_doc["pages"])

    # 预处理：合并被切断的编号行
    # e.g. "06010\n1" -> "060101"
    full_text = re.sub(r'(\d{4,5})\n(\d{1,2})\b', r'\1\2', full_text)

    lines = full_text.split("\n")

    # 主正则：匹配 "编码 名称" 格式的行
    # 2-6 位数字 + 至少1个空格 + 非空白字符开始
    code_pattern = re.compile(r'^(\d{2}|\d{4}|\d{6})\s+(\S.*?)(?:\s{2,}|$)')

    nodes = []
    seen_codes = set()

    for line in lines:
        line = line.strip()
        if not line:
            continue

        match = code_pattern.match(line)
        if not match:
            continue

        code = match.group(1)
        name = match.group(2).strip()

        # 清洗名称：去除末尾标点、多余描述
        name = re.sub(r'\s*[��].*$', '', name)

        # 去重
        if code in seen_codes:
            continue
        seen_codes.add(code)

        # 判层级
        if len(code) == 2:
            level = "大类"
            parent_code = None
        elif len(code) == 4:
            level = "中类"
            parent_code = code[:2]
        elif len(code) == 6:
            level = "小类"
            parent_code = code[:4]
        else:
            continue

        # 清洗名称：去除残留的数字编码
        name = re.sub(r'\b\d{2,6}\b', '', name)    # 删"0504"等编码碎片
        name = re.sub(r'\s{2,}', ' ', name).strip() # 合并多余空格

        # 过滤噪声：名称必须含中文字符
        if not re.search(r'[一-鿿]', name):
            continue

        # 如果清洗后名称过短（只剩"湿地 "这种归类词），丢弃
        if len(name) < 3:
            continue

        nodes.append({
            "name": name,
            "code": code,
            "level": level,
            "parent_code": parent_code,
        })

    # 补充：构建父子关系验证
    all_codes = {n["code"] for n in nodes}
    for n in nodes:
        if n["parent_code"] and n["parent_code"] not in all_codes:
            # 父节点缺失（可能在 PDF 中未被匹配到），标记为无父
            n["parent_code"] = None

    return nodes


if __name__ == "__main__":
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from config import PDF_FILES
    from parse_pdf import parse_pdf

    pdf_info = PDF_FILES[1]
    parsed = parse_pdf(pdf_info["path"])
    nodes = extract_landuse(parsed)

    levels = {"大类": 0, "中类": 0, "小类": 0}
    for n in nodes:
        levels[n["level"]] += 1

    print(f"文档: {parsed['title']}")
    print(f"总节点: {len(nodes)}")
    print(f"  大类: {levels['大类']}, 中类: {levels['中类']}, 小类: {levels['小类']}")
    print()
    for level in ["大类", "中类", "小类"]:
        samples = [n for n in nodes if n["level"] == level][:5]
        print(f"[{level}] 前 5 个:")
        for s in samples:
            parent = f" -> parent: {s['parent_code']}" if s['parent_code'] else ""
            print(f"  {s['code']} {s['name']}{parent}")
