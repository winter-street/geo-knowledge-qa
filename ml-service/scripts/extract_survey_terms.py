"""
从 GB/T 14911-2008《测绘基本术语》PDF 提取术语词条

格式特征：
  线1: ２．１          ← 术语编号（全角字符）
  线2: 测绘 狊...；犛犕  ← 中文术语名 + 英文术语（稀有CJK字形）
  线3+: 定义文本段落    ← 多行定义，直到下一个术语编号

注意：
  - 术语名中的连接符使用 Private Use Area (PUA) 字符，如 0xE011
  - 英文术语使用特殊 CJK 字形渲染，需要剥离
"""
import re
import os
import sys


# 允许出现在术语名中的字符
ALLOWED_IN_NAME = {
    '·', '·', '—', '–', '-', '－', '~', '～',
    '（', '）', '(', ')', '、', '／', '/', '&',
    '·', 'ʼ',  # 间隔号变体
}


def extract_survey_terms(parsed_doc: dict) -> list:
    terms = []
    current_term_num = None
    current_chinese_name = None
    current_synonyms = []
    current_def_parts = []
    started = False

    for page in parsed_doc["pages"]:
        text = page["text"]
        if not text:
            continue
        lines = text.split("\n")
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            # === 跳过页眉 ===
            if stripped.startswith("犌犅／犜"):
                continue

            # === 遇到参考文献/索引时终止（英文或中文，可能有空格） ===
            stripped_nospace = stripped.replace(' ', '').replace('　', '')
            if any(kw in stripped_nospace for kw in ['参考文献', '中文索引', '英文索引', '参考文献']):
                started = False
                continue

            # === 检测章节标题（如"２ 测绘总类"） ===
            section_match = re.match(r'^([０-９])\s+\S', stripped)
            if section_match:
                # 仅当章节号 <= 5 时才继续
                section_char = section_match.group(1)
                section_num = ord(section_char) - 0xff10  # 全角转半角
                if section_num > 5:
                    started = False
                continue

            # === 跳过"范围"、"前言"等 ===
            if stripped in ("范围", "前言", "引言"):
                continue

            # === 跳过仅含英文残余的行 ===
            if _is_english_only(stripped):
                continue

            # === 检测术语编号行：如 ２．１、２．１０ ===
            term_num_match = re.match(r'^([０-９]+)．([０-９]+)$', stripped)
            if term_num_match:
                if current_chinese_name and current_def_parts:
                    _save_term(terms, current_chinese_name, current_synonyms, current_def_parts)

                num1 = _fullwidth_to_digits(term_num_match.group(1))
                num2 = _fullwidth_to_digits(term_num_match.group(2))
                current_term_num = f"{num1}.{num2}"
                current_chinese_name = None
                current_synonyms = []
                current_def_parts = []
                started = True
                continue

            if not started:
                continue

            # === 术语名称行（编号后的下一行） ===
            if current_term_num and current_chinese_name is None:
                name = _extract_main_name(stripped)
                if name and len(name) >= 2:
                    current_chinese_name = name
                    continue
                else:
                    current_term_num = None
                    continue

            # === 同义词行：当前术语后的纯中文短行 ===
            if current_chinese_name:
                syn = _check_synonym_line(stripped, current_def_parts)
                if syn:
                    current_synonyms.append(syn)
                    continue

            # === 积累定义 ===
            if current_chinese_name:
                cleaned = _clean_definition_line(stripped)
                if cleaned:
                    current_def_parts.append(cleaned)

    if current_chinese_name and current_def_parts:
        _save_term(terms, current_chinese_name, current_synonyms, current_def_parts)

    return terms


def _fullwidth_to_digits(s: str) -> str:
    result = ""
    for ch in s:
        if '０' <= ch <= '９':
            result += chr(ord('0') + ord(ch) - 0xff10)
        else:
            result += ch
    return result


def _extract_main_name(text: str) -> str:
    """
    从术语行的开头提取中文名称。
    允许汉字 + 连接符 + 括号，遇到空格或英文特殊CJK字形时停止。
    """
    name = ""
    for ch in text:
        cp = ord(ch)
        # 汉字
        if (0x4E00 <= cp <= 0x9FFF) or (0x3400 <= cp <= 0x4DBF):
            name += ch
        # 允许的标点
        elif ch in ALLOWED_IN_NAME:
            name += ch
        # PUA 字符（如 0xE011 用于破折号/连接符）
        elif 0xE000 <= cp <= 0xF8FF:
            name += "—"  # 映射为普通破折号
        # 空格或特殊 CJK（英文渲染）—— 终止
        elif ch == ' ' or _is_rare_cjk(ch):
            break
        else:
            break

    name = name.strip(' ·—–-－~～')
    return name if len(name) >= 2 else None


# 已知用于渲染英文字母的稀有 CJK 字形
RARE_CJK_FOR_ENGLISH = {
    '犕', '犛', '犜', '犌', '犅', '犑', '犖', '犝', '犃', '犇',
    '犉', '犆', '犈', '犔', '犗', '犘', '犙', '犚', '犞',
    '犟', '犠', '犡', '犢', '犣', '犤', '犥', '犦', '犪', '犫',
    '犮', '犱', '犵', '犺', '犻', '犼', '犾', '狅', '狆', '狋',
    '狌', '狑', '狔', '狟', '狣', '狪', '狫',
    '犭', '犮', '犱', '犲', '犳', '犴', '犵',
    '犽', '犾', '犿', '狊', '狋', '狌', '狍',
    '狎', '狏', '狑', '狓', '狔', '狟',
    '狟', '狪', '狫', '狵', '犉', '犃', '犆',
    '犜', '犗', '犘',
    # 添加从页面6看到的
    '犺', '犻', '犼',
}

# 定义特征词（同义词行不应包含这些）
DEF_MARKERS = {'的', '和', '与', '或', '是', '为', '指', '用', '对', '在', '从',
               '由', '将', '以', '被', '把', '向', '按', '通过'}


def _is_rare_cjk(ch: str) -> bool:
    """判断是否为英文渲染用的稀有CJK字形"""
    return ch in RARE_CJK_FOR_ENGLISH


def _is_english_only(text: str) -> bool:
    """判断是否仅为英文残余"""
    chinese_count = 0
    common_chinese = 0
    for ch in text:
        cp = ord(ch)
        if (0x4E00 <= cp <= 0x9FFF) or (0x3400 <= cp <= 0x4DBF):
            chinese_count += 1
            if ch not in RARE_CJK_FOR_ENGLISH:
                common_chinese += 1
    # 如果没有常见汉字，或全是稀有CJK，视为英文残余
    return common_chinese == 0 and chinese_count > 0


def _check_synonym_line(text: str, def_parts: list) -> str:
    """
    检查一行是否为同义词。
    同义词特征：纯中文短行（2-8字），且不是定义的一部分。
    """
    # 收集纯中文字符
    chinese_chars = []
    for ch in text:
        cp = ord(ch)
        if (0x4E00 <= cp <= 0x9FFF) or (0x3400 <= cp <= 0x4DBF):
            chinese_chars.append(ch)
        elif ch not in (' ', '\t'):
            # 有非空白非中文的字符，不是同义词
            return None

    if len(chinese_chars) < 2 or len(chinese_chars) > 8:
        return None

    potential = "".join(chinese_chars)

    # 如果包含定义特征词，不是同义词
    if any(marker in potential for marker in DEF_MARKERS):
        return None

    # 如果有定义积累且同义词被定义内容包含，则不是同义词
    if def_parts:
        def_text = "".join(def_parts)
        if potential in def_text:
            return None

    # 排除页码、数字等
    if potential.isdigit():
        return None

    return potential


def _clean_definition_line(text: str) -> str:
    """清洗定义行：去掉英文残余字符"""
    cleaned = ""
    for ch in text:
        cp = ord(ch)
        # 跳过全角拉丁字母和特殊 CJK 字形
        if 0xFF01 <= cp <= 0xFF5E:
            continue
        if ch in RARE_CJK_FOR_ENGLISH:
            continue
        cleaned += ch
    return cleaned.strip()


def _save_term(terms: list, name: str, synonyms: list, def_parts: list):
    if len(name) < 2:
        return

    full_def = "".join(def_parts).strip()

    # 清洗定义中的残留字符
    cleaned_def = ""
    for ch in full_def:
        cp = ord(ch)
        if ch in RARE_CJK_FOR_ENGLISH or (0xFF01 <= cp <= 0xFF5E):
            continue
        cleaned_def += ch
    full_def = cleaned_def.strip()

    # 合并同义词
    valid_synonyms = [s for s in synonyms if s and s != name and s not in full_def[:20]]
    display_name = "／".join([name] + valid_synonyms) if valid_synonyms else name

    if len(full_def) < 5:
        return
    if full_def.startswith("见"):
        return

    terms.append({
        "name": display_name,
        "definition": full_def,
        "type": "术语",
    })


if __name__ == "__main__":
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from parse_pdf import parse_pdf

    pdf_path = "D:/1GISwork/6-GISdevelop/data/samples/测绘基本术语.pdf"
    parsed = parse_pdf(pdf_path)
    terms = extract_survey_terms(parsed)
    print(f"提取 {len(terms)} 条术语")
    for t in terms[:50]:
        print(f"  [{t['name']}] {t['definition'][:80]}...")
