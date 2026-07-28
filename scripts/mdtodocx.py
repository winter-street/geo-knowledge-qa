"""
将 ex5-数据库设计.md 转换为格式完整的 .docx 文件。
使用 python-docx 库，处理标题层级、表格、代码块、Mermaid 图等。
运行: python md2docx.py
"""

from docx import Document
from docx.shared import Pt, Inches, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
import re
import os

MD_FILE = "../选题汇报.md"
DOCX_FILE = "../xthb.docx"


def set_cell_font(cell, text, bold=False, size=9):
    """设置单元格字体（支持行内格式：粗体、行内代码）"""
    for paragraph in cell.paragraphs:
        paragraph.clear()
    p = cell.paragraphs[0]
    process_inline_formatting(p, text)
    # 统一调整段落中所有 run 的字号
    for run in p.runs:
        run.font.size = Pt(size)
        if run.font.name != 'Consolas':
            run.font.name = '微软雅黑'
            run._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')


def add_table_from_md(doc, lines, start_idx):
    """解析 Markdown 表格并添加到 docx"""
    # 收集表格行
    table_rows = []
    i = start_idx
    while i < len(lines) and lines[i].strip().startswith('|'):
        row = [cell.strip() for cell in lines[i].strip().strip('|').split('|')]
        table_rows.append(row)
        i += 1

    if not table_rows or len(table_rows) < 2:
        return i

    # 过滤分隔行 (|---|---|)
    data_rows = []
    header = table_rows[0]
    for row in table_rows[1:]:
        if not all(re.match(r'^[-:]+$', cell) for cell in row):
            data_rows.append(row)

    # 创建 Word 表格
    table = doc.add_table(rows=1 + len(data_rows), cols=len(header))
    table.style = 'Light Grid Accent 1'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER

    # 表头
    for j, cell_text in enumerate(header):
        set_cell_font(table.rows[0].cells[j], cell_text, bold=True, size=9)

    # 数据行
    for row_idx, row in enumerate(data_rows):
        for col_idx, cell_text in enumerate(row):
            if col_idx < len(header):
                set_cell_font(table.rows[row_idx + 1].cells[col_idx], cell_text, size=9)

    doc.add_paragraph()  # 表后空行
    return i


def add_code_block(doc, code_lines, lang=''):
    """添加代码块（灰色背景、等宽字体），lang 为可选语言标签"""
    if lang:
        label = doc.add_paragraph()
        label.paragraph_format.space_before = Pt(4)
        label.paragraph_format.space_after = Pt(0)
        label.paragraph_format.left_indent = Cm(0.5)
        run = label.add_run(f'▎{lang}')
        run.font.size = Pt(7.5)
        run.font.color.rgb = RGBColor(0x99, 0x99, 0x99)
        run.font.name = '微软雅黑'
        run._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    for line in code_lines:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.left_indent = Cm(0.5)
        run = p.add_run(line)
        run.font.name = 'Consolas'
        run.font.size = Pt(8.5)
        run.font.color.rgb = RGBColor(0x33, 0x33, 0x33)
    doc.add_paragraph()  # 代码块后空行


def replace_box_chars(text):
    """将目录树 Box-Drawing 字符替换为 ASCII 兼容版本"""
    return text.replace('├──', '  |--').replace('└──', '  `--').replace('│', '|')


def process_markdown(md_path, docx_path):
    """主转换函数"""
    with open(md_path, 'r', encoding='utf-8') as f:
        raw = f.read()

    # 预处理：替换 Box-Drawing 字符（微软雅黑不支持）
    raw = replace_box_chars(raw)
    lines = raw.split('\n')

    doc = Document()

    # 设置默认字体
    style = doc.styles['Normal']
    font = style.font
    font.name = '微软雅黑'
    font.size = Pt(10.5)
    style.element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')

    i = 0
    in_code_block = False
    code_buffer = []
    lang = ''
    mermaid_count = 0

    while i < len(lines):
        line = lines[i].rstrip()

        # 代码块处理
        if line.strip().startswith('```'):
            if in_code_block:
                if lang == 'mermaid':
                    # Mermaid 图：插入占位提示（不渲染为代码块）
                    mermaid_count += 1
                    p = doc.add_paragraph()
                    run = p.add_run(f'[ 图 {mermaid_count} — Mermaid 流程图，请从 Markdown 源文件复制代码手动生成 PNG 插入此处 ]')
                    run.font.size = Pt(9)
                    run.font.color.rgb = RGBColor(0x99, 0x99, 0x99)
                    run.italic = True
                    doc.add_paragraph()
                else:
                    add_code_block(doc, code_buffer, lang)
                code_buffer = []
                lang = ''
                in_code_block = False
            else:
                in_code_block = True
                lang = line.strip()[3:].strip()  # 提取语言标识符（mermaid/python/sql等）
            i += 1
            continue

        if in_code_block:
            code_buffer.append(line)
            i += 1
            continue

        # 标题 # → Heading 1
        if line.startswith('# ') and not line.startswith('## '):
            text = line[2:].strip()
            h = doc.add_heading(text, level=1)
            i += 1
            continue

        # 标题 ## → Heading 2
        if line.startswith('## ') and not line.startswith('### '):
            text = line[3:].strip()
            h = doc.add_heading(text, level=2)
            i += 1
            continue

        # 标题 ### → Heading 3
        if line.startswith('### ') and not line.startswith('#### '):
            text = line[4:].strip()
            h = doc.add_heading(text, level=3)
            i += 1
            continue

        # 标题 #### → Heading 4
        if line.startswith('#### '):
            text = line[5:].strip()
            h = doc.add_heading(text, level=4)
            i += 1
            continue

        # Markdown 表格
        if line.strip().startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s\-:]+\|', lines[i + 1].strip()):
            i = add_table_from_md(doc, lines, i)
            continue

        # 水平线
        if line.strip() == '---':
            doc.add_paragraph('—' * 40)
            i += 1
            continue

        # 空行
        if not line.strip():
            i += 1
            continue

        # 引用块 >
        if line.strip().startswith('> '):
            text = line.strip()[2:]
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(1)
            run = p.add_run(text)
            run.font.size = Pt(9.5)
            run.font.color.rgb = RGBColor(0x66, 0x66, 0x66)
            run.italic = True
            i += 1
            continue

        # 无序列表
        if line.strip().startswith('- ') or line.strip().startswith('* '):
            text = re.sub(r'^[\-\*]\s+', '', line.strip())
            # 处理粗体 **text**
            p = doc.add_paragraph(style='List Bullet')
            process_inline_formatting(p, text)
            i += 1
            continue

        # 有序列表
        if re.match(r'^\d+[\.\)]\s', line.strip()):
            text = re.sub(r'^\d+[\.\)]\s+', '', line.strip())
            p = doc.add_paragraph(style='List Number')
            process_inline_formatting(p, text)
            i += 1
            continue

        # 普通段落
        p = doc.add_paragraph()
        process_inline_formatting(p, line.strip())
        i += 1

    # 保存
    doc.save(docx_path)
    print(f"[OK] 转换完成: {docx_path}")


def process_inline_formatting(paragraph, text):
    """处理行内格式：粗体 **text**、行内代码 `code`、普通文本"""
    # 分割 **bold** 和 `code`
    tokens = re.split(r'(\*\*.*?\*\*|`.*?`)', text)
    for token in tokens:
        if token.startswith('**') and token.endswith('**'):
            run = paragraph.add_run(token[2:-2])
            run.bold = True
        elif token.startswith('`') and token.endswith('`'):
            run = paragraph.add_run(token[1:-1])
            run.font.name = 'Consolas'
            run.font.size = Pt(9)
        else:
            paragraph.add_run(token)


if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))
    md_path = os.path.join(script_dir, MD_FILE)
    docx_path = os.path.join(script_dir, DOCX_FILE)

    if not os.path.exists(md_path):
        print(f"[ERR] 找不到文件: {md_path}")
        exit(1)

    print(f"Converting {md_path} ...")
    process_markdown(md_path, docx_path)
