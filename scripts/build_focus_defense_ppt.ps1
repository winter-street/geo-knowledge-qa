$source = 'D:\1GISwork\6-GISdevelop\docs\地理知识图谱与RAG增强的智能问答系统-答辩-修订版-v2.pptx'
$outputDir = 'D:\1GISwork\6-GISdevelop\docs\ppt\终期报告'
$output = Join-Path $outputDir '地理知识图谱与RAG增强的智能问答系统-终期汇报-重点版.pptx'
$svgPath = Join-Path $outputDir 'owl-inference-focus.svg'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Write-ZipXml {
  param([System.IO.Compression.ZipArchive]$Zip, [string]$EntryName, [xml]$Xml)
  $old = $Zip.GetEntry($EntryName)
  if (-not $old) { throw "PPTX entry not found: $EntryName" }
  $old.Delete()
  $new = $Zip.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
  $writer = New-Object IO.StreamWriter($new.Open(), (New-Object Text.UTF8Encoding($false)))
  $Xml.Save($writer)
  $writer.Close()
}

function Set-ShapeText {
  param([System.Xml.XmlElement]$Shape, [System.Xml.XmlNamespaceManager]$Ns, [string]$Value)
  $textNodes = @($Shape.SelectNodes('.//a:t', $Ns))
  if ($textNodes.Count -eq 0) { return }
  $textNodes[0].InnerText = $Value
  for ($i = 1; $i -lt $textNodes.Count; $i += 1) { $textNodes[$i].InnerText = '' }
}

$replacements = @{
  1 = @{
    'Text 11' = '实习终期汇报 · 8 分钟重点讲解'
    'Text 12' = '小组成员：张晓凯   张馨月   张仔恒        时间：2026.07'
  }
  4 = @{
    'Text 1' = '01  需求与交付：解决什么问题，完成了什么'
    'Text 4' = '核心需求'
    'Text 5' = '地质报告篇幅长、术语分散，传统关键词检索难以同时回答“依据来自哪一页”和“实体之间有什么关联”。系统将文献片段与图谱关系转为同一问题的两类可追溯证据。'
    'Text 6' = '已实现 · 可验证交付'
    'Text 14' = '5 类'
    'Text 15' = '核心地质实体类型'
    'Text 23' = '双路径'
    'Text 24' = 'RAG 文献 + KG 关系证据'
    'Text 25' = '统计来源：geo_knowledge.db（文献和切片）；图谱、推理与问答结果均可由系统和代码现场验证。'
  }
  6 = @{
    'Text 1' = '02  一个问题贯穿全系统：双路取证，再组织答案'
    'Text 5' = '用户提出问题'
    'Text 7' = '“哪些矿产受构造控制？”'
    'Text 9' = '证据一：RAG'
    'Text 11' = '文献片段 + 页码'
    'Text 13' = '证据二：知识图谱'
    'Text 17' = '后端并行编排'
    'Text 19' = 'Promise.all：RAG + KG + 空间'
    'Text 21' = '低相关性关守 + Prompt 组装'
    'Text 23' = 'SSE 流式回答 + 来源卡'
    'Text 25' = 'JWT 鉴权 + 问答日志'
    'Text 28' = '输出：有证据的地学回答'
    'Text 29' = '答案、引用页码、实体关系、可选空间标注'
    'Text 33' = '离线知识底座'
    'Text 35' = 'SQLite'
    'Text 36' = '文档块与 BGE 向量'
    'Text 38' = 'Neo4j'
    'Text 39' = '实体关系与推理边'
    'Text 41' = 'PDF 文献'
    'Text 42' = '原始报告与页码来源'
    'Text 44' = 'OWL 本体'
    'Text 45' = '离线规则推理'
    'Text 47' = 'Python 检索服务'
    'Text 48' = 'BGE 编码 · Top-K 召回 · 实体关系抽取 · 本体推理'
    'Text 49' = '输入问题 → 并行取证 → 模型基于证据组织回答；后续每个模块都可在 IDE 中定位到对应代码。'
  }
  8 = @{
    'Text 1' = '03  RAG：从地质报告中取回可引用的原文证据'
    'Text 5' = '输入：用户问题'
    'Text 6' = '问题加检索前缀后由 bge-small-zh-v1.5 编码为 512 维向量；文档块已离线编码并保存在 SQLite。'
    'Text 9' = '处理：相似度 Top-K'
    'Text 10' = '在 server.py 的 _search_bge() 中执行 chunk_vectors @ q_vec，按得分排序取 Top-K，而不是只做关键词匹配。'
    'Text 13' = '输出：可溯源证据'
    'Text 14' = '返回文本片段、来源标题、页码和相关度，后端将它们写入 Prompt 与 SourceCard。'
    'Text 16' = '效果  回答有文献依据：RAG 负责回答“报告中哪里说过”，Neo4j 负责补充“实体之间如何关联”。'
  }
  10 = @{
    'Text 1' = '04  离线知识构建：把报告加工为两类检索证据'
    'Text 3' = '输入 PDF 地质报告；一次预处理生成向量库、图数据库与可复用的推理关系'
    'Text 48' = '输出：向量库 + 图谱 + 本体推理边。在线问答只检索已建好的知识，不重复解析整份 PDF。'
  }
  11 = @{
    'Text 1' = '07  在线问答编排：两类证据并行进入同一次回答'
    'Text 4' = '输入问题'
    'Text 5' = '“哪些矿产受构造控制？”'
    'Text 8' = '问题解析'
    'Text 9' = 'nodejieba 分词 · 提取检索关键词与空间意图'
    'Text 11' = 'Promise.all 并行检索'
    'Text 29' = '证据汇合：RAG 原文片段 + KG 路径 + 可选空间结果'
    'Text 32' = 'Prompt 上下文组装'
    'Text 33' = '片段（标题/页码）+ 实体关系 + 当前问题；低相关性时直接返回引导，避免无依据生成。'
    'Text 36' = 'LLM 组织回答'
    'Text 37' = 'DeepSeek 主模型；非流式可尝试备用模型'
    'Text 39' = 'SSE 流式回传'
    'Text 40' = 'meta → chunk → done；答案、来源、图谱关系和空间结果一并给前端。代码：backend/src/routes/qa.ts'
  }
  14 = @{
    'Text 1' = '08  视频演示：用同一问题验证端到端运行'
    'Text 18' = '演示问题：哪些矿产受构造控制？'
    'Text 20' = '录制视频依次展示：登录 → 输入问题 → 流式回答 → 来源页码 → 图谱关系/地图标注。重点不是浏览界面，而是验证“证据到答案”的闭环。'
    'Text 29' = '① 发起问题'
    'Text 30' = '前端发送 retrievalMode 与问题文本；JWT 由请求拦截器附带。'
    'Text 33' = '② 查看来源'
    'Text 34' = '回答下方展示文档标题与页码，老师可追问时回到原始证据。'
    'Text 37' = '③ 观察流式过程'
    'Text 38' = '先收到 meta，再持续接收文字 chunk，最后收到 done 和来源数据。'
    'Text 41' = '④ 进入代码'
    'Text 42' = '视频结束后打开 IDE：RAG、qa.ts 编排、OWL 推理三处关键代码。'
  }
  18 = @{
    'Text 1' = '09  IDE 代码讲解：老师可沿三处入口追问'
    'Text 5' = '01'
    'Text 6' = 'RAG 相似度检索'
    'Text 7' = 'ml-service/server.py → _search_bge()：问题向量 q_vec 与 _chunk_vectors 点积，排序后截取 Top-K。'
    'Text 10' = '02'
    'Text 11' = '在线并行编排'
    'Text 12' = 'backend/src/routes/qa.ts → Promise.all：RAG、KG 和空间查询并行；随后构建 Prompt 并调用 generateAnswerStream。'
    'Text 15' = '03'
    'Text 16' = 'OWL 推理与回写'
    'Text 17' = 'ml-service/scripts/run_reasoning.py：读取显式关系，按规则求闭包，差分后以 inferred:true 写回 Neo4j。'
    'Text 20' = '答疑口径'
    'Text 21' = '不要只报技术名词。按“输入是什么 → 如何处理 → 输出什么 → 解决什么问题 → 代码在哪里”逐段说明。'
  }
  22 = @{
    'Text 7' = '结论：先取证，再回答；先补全知识，再检索'
    'Text 8' = '已完成 RAG 文献溯源、Neo4j 关系检索、OWL 离线推理回写与流式问答展示。'
    'Text 10' = '边界：空间评分为 demo-v1 规则演示；OWL 不宣称未经测试的性能收益；推理边保留 inferred 标记。'
    'Text 11' = '中南大学 · 实习终期汇报 · 恳请批评指正'
  }
}

if (-not (Test-Path $source)) { throw "Source PPTX not found: $source" }
if (-not (Test-Path $svgPath)) { throw "SVG not found: $svgPath" }
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
Copy-Item -LiteralPath $source -Destination $output -Force

$zip = [System.IO.Compression.ZipFile]::Open($output, [System.IO.Compression.ZipArchiveMode]::Update)
try {
  foreach ($slideNumber in $replacements.Keys) {
    $entryName = "ppt/slides/slide$slideNumber.xml"
    $reader = New-Object IO.StreamReader($zip.GetEntry($entryName).Open())
    [xml]$xml = $reader.ReadToEnd(); $reader.Close()
    $ns = New-Object Xml.XmlNamespaceManager($xml.NameTable)
    $ns.AddNamespace('p', 'http://schemas.openxmlformats.org/presentationml/2006/main')
    $ns.AddNamespace('a', 'http://schemas.openxmlformats.org/drawingml/2006/main')
    $shapeByName = @{}
    foreach ($shape in $xml.SelectNodes('//p:sp', $ns)) {
      $nameNode = $shape.SelectSingleNode('./p:nvSpPr/p:cNvPr', $ns)
      if ($nameNode) { $shapeByName[$nameNode.GetAttribute('name')] = $shape }
    }
    foreach ($shapeName in $replacements[$slideNumber].Keys) {
      if (-not $shapeByName.ContainsKey($shapeName)) { throw "Slide $slideNumber missing shape: $shapeName" }
      Set-ShapeText -Shape $shapeByName[$shapeName] -Ns $ns -Value $replacements[$slideNumber][$shapeName]
    }
    Write-ZipXml -Zip $zip -EntryName $entryName -Xml $xml
  }

  $mediaEntryName = 'ppt/media/owl-inference-focus.svg'
  $existingMedia = $zip.GetEntry($mediaEntryName)
  if ($existingMedia) { $existingMedia.Delete() }
  $mediaEntry = $zip.CreateEntry($mediaEntryName, [System.IO.Compression.CompressionLevel]::Optimal)
  $stream = $mediaEntry.Open(); $bytes = [IO.File]::ReadAllBytes($svgPath); $stream.Write($bytes, 0, $bytes.Length); $stream.Close()

  $typesReader = New-Object IO.StreamReader($zip.GetEntry('[Content_Types].xml').Open())
  [xml]$types = $typesReader.ReadToEnd(); $typesReader.Close()
  $contentNs = 'http://schemas.openxmlformats.org/package/2006/content-types'
  if (@($types.Types.Default | Where-Object { $_.Extension -eq 'svg' }).Count -eq 0) {
    $svgType = $types.CreateElement('Default', $contentNs); $svgType.SetAttribute('Extension', 'svg'); $svgType.SetAttribute('ContentType', 'image/svg+xml'); $types.Types.AppendChild($svgType) | Out-Null
  }
  Write-ZipXml -Zip $zip -EntryName '[Content_Types].xml' -Xml $types

  $relName = 'ppt/slides/_rels/slide12.xml.rels'
  $relsReader = New-Object IO.StreamReader($zip.GetEntry($relName).Open())
  [xml]$rels = $relsReader.ReadToEnd(); $relsReader.Close()
  $relNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
  foreach ($rel in @($rels.Relationships.Relationship | Where-Object { $_.Id -eq 'rId99' })) { $rels.Relationships.RemoveChild($rel) | Out-Null }
  $newRel = $rels.CreateElement('Relationship', $relNs); $newRel.SetAttribute('Id', 'rId99'); $newRel.SetAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'); $newRel.SetAttribute('Target', '../media/owl-inference-focus.svg'); $rels.Relationships.AppendChild($newRel) | Out-Null
  Write-ZipXml -Zip $zip -EntryName $relName -Xml $rels

  $slideReader = New-Object IO.StreamReader($zip.GetEntry('ppt/slides/slide12.xml').Open())
  [xml]$slide = $slideReader.ReadToEnd(); $slideReader.Close()
  $slideNs = New-Object Xml.XmlNamespaceManager($slide.NameTable)
  $slideNs.AddNamespace('p', 'http://schemas.openxmlformats.org/presentationml/2006/main')
  $spTree = $slide.SelectSingleNode('/p:sld/p:cSld/p:spTree', $slideNs)
  foreach ($child in @($spTree.ChildNodes)) { if ($child.LocalName -notin @('nvGrpSpPr', 'grpSpPr')) { $spTree.RemoveChild($child) | Out-Null } }
  $fragment = $slide.CreateDocumentFragment()
  $fragment.InnerXml = @'
<p:pic xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:nvPicPr><p:cNvPr id="2000" name="OWL Inference Focus"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId99"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>
'@
  $spTree.AppendChild($fragment.FirstChild) | Out-Null
  Write-ZipXml -Zip $zip -EntryName 'ppt/slides/slide12.xml' -Xml $slide

  $presentationReader = New-Object IO.StreamReader($zip.GetEntry('ppt/presentation.xml').Open())
  [xml]$presentation = $presentationReader.ReadToEnd(); $presentationReader.Close()
  $pns = New-Object Xml.XmlNamespaceManager($presentation.NameTable)
  $pns.AddNamespace('p', 'http://schemas.openxmlformats.org/presentationml/2006/main')
  $pns.AddNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  $slideIdList = $presentation.SelectSingleNode('/p:presentation/p:sldIdLst', $pns)
  $allIds = @($slideIdList.SelectNodes('./p:sldId', $pns))
  $presentationRelsReader = New-Object IO.StreamReader($zip.GetEntry('ppt/_rels/presentation.xml.rels').Open())
  [xml]$presentationRels = $presentationRelsReader.ReadToEnd(); $presentationRelsReader.Close()
  $targetByRelationship = @{}
  foreach ($relationship in @($presentationRels.Relationships.Relationship)) { $targetByRelationship[$relationship.Id] = $relationship.Target }
  $keepSlides = @(1,4,6,10,8,12,11,14,18,22)
  $kept = foreach ($n in $keepSlides) {
    $target = "slides/slide$n.xml"
    $match = $allIds | Where-Object { $targetByRelationship[$_.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')] -eq $target }
    if (-not $match) { throw "Slide $n is not active in the source presentation" }
    $match
  }
  foreach ($node in @($allIds)) { $slideIdList.RemoveChild($node) | Out-Null }
  foreach ($node in $kept) { $slideIdList.AppendChild($node) | Out-Null }
  $sections = $presentation.SelectSingleNode('/p:presentation/p:sectionLst', $pns)
  if ($sections) { $sections.ParentNode.RemoveChild($sections) | Out-Null }
  Write-ZipXml -Zip $zip -EntryName 'ppt/presentation.xml' -Xml $presentation
}
finally { $zip.Dispose() }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$check = [System.IO.Compression.ZipFile]::OpenRead($output)
try {
  $presentationEntry = $check.GetEntry('ppt/presentation.xml')
  $reader = New-Object IO.StreamReader($presentationEntry.Open()); [xml]$xml = $reader.ReadToEnd(); $reader.Close()
  $ns = New-Object Xml.XmlNamespaceManager($xml.NameTable); $ns.AddNamespace('p', 'http://schemas.openxmlformats.org/presentationml/2006/main')
  $count = @($xml.SelectNodes('/p:presentation/p:sldIdLst/p:sldId', $ns)).Count
  if ($count -ne 10) { throw "Expected 10 slides, got $count" }
}
finally { $check.Dispose() }

Write-Output "Validated 10 slides: $output"
