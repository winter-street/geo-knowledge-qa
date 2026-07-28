# 作品集构建说明

最终上传文件位于上一级目录。`source/` 保存可复现的内容模型、绘图脚本、PDF 构建器和校验器。

## 环境

- Python 3.10 或更高版本
- Poppler，用于把 PDF 渲染为逐页 PNG
- 一套支持中文的无衬线、粗体和衬线字体

安装固定版本的 Python 依赖：

```powershell
python -m pip install -r portfolio/geo-knowledge-rag/source/requirements.txt
```

脚本会自动查找 Windows 的微软雅黑/宋体、Linux 的 Noto CJK 或 macOS 中文字体。也可显式指定本地字体文件：

```powershell
$env:PORTFOLIO_FONT_REGULAR = '.\fonts\NotoSansCJK-Regular.ttc'
$env:PORTFOLIO_FONT_BOLD = '.\fonts\NotoSansCJK-Bold.ttc'
$env:PORTFOLIO_FONT_SERIF = '.\fonts\NotoSerifCJK-Regular.ttc'
$env:PORTFOLIO_FONT_LATIN = '.\fonts\DejaVuSans.ttf'
```

这些示例路径仅为本地配置示意，不会写入生成的封面或 PDF。

## 构建

```powershell
python portfolio/geo-knowledge-rag/source/build_assets.py
python portfolio/geo-knowledge-rag/source/build_portfolio.py
```

使用 Poppler 把最终 PDF 渲染为 `rendered/page-01.png` 到 `page-10.png`：

```powershell
pdftoppm -png -r 150 -f 1 -l 10 `
  'portfolio/geo-knowledge-rag/地质知识图谱与RAG项目作品集.pdf' `
  'portfolio/geo-knowledge-rag/rendered/page'
```

然后执行：

```powershell
python portfolio/geo-knowledge-rag/source/validate_portfolio.py --all
python -m unittest discover -s portfolio/geo-knowledge-rag/source -p 'test_*.py'
```

`--all` 会检查 10 页内容模型、封面与技术图尺寸、PDF 页数和 A4 横向版式、可点击链接、渲染页尺寸以及敏感信息模式，并打印最终交付清单。
