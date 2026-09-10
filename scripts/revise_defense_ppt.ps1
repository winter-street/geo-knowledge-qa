[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$Source,
  [string]$Output
)

$source = (Resolve-Path -LiteralPath $Source).Path
if (-not $Output) {
  $Output = Join-Path (Split-Path -Parent $source) '地理知识图谱与RAG增强的智能问答系统-答辩-修订版.pptx'
}
$output = [System.IO.Path]::GetFullPath($Output)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Copy-Item -LiteralPath $source -Destination $output -Force

$replacements = @{
  4 = @{
    'Text 5' = '面向 GIS / 地质找矿领域。系统以 RAG 文献检索与知识图谱关系检索为两类证据来源，将非结构化 PDF 转为可检索、可溯源、可推理的专业问答服务。RAG 返回原文和页码，图谱返回实体关系，模型负责基于证据组织答案。'
    'Text 8' = '44 篇'
    'Text 9' = '已入库 PDF 文献'
    'Text 11' = '3454 个'
    'Text 12' = '文本切片'
    'Text 14' = '5 类'
    'Text 15' = '主要地质实体类型'
    'Text 17' = '8 类'
    'Text 18' = '图谱关系类型'
    'Text 20' = '512 维'
    'Text 21' = 'BGE 中文语义向量'
    'Text 23' = '双模型'
    'Text 24' = 'DeepSeek 主 / 通义备用'
    'Text 25' = '统计截至 2026.07.13：文献与切片来自 geo_knowledge.db；图谱节点与关系数量由管理端实时读取。'
  }
  8 = @{
    'Text 9' = '图数据库 (Neo4j)'
    'Text 10' = '7 类节点（矿产、岩石、构造、年代、成因、区域、文档）+ 8 类关系；Document-REFERENCES 保留文献来源，支持局部子图和关系查询。'
    'Text 13' = '本体模型 (OWL)'
    'Text 14' = 'GeoEntity 父类 + 基础实体类与语义类；BELONGS_TO、LIES_IN 做传递闭包，ASSOCIATED_WITH 补反向关系；HermiT 与规则推理产生 inferred:true 关系。'
    'Text 16' = '三库协同  SQLite 负责语义召回与页码溯源 · Neo4j 负责结构化关系 · OWL 负责离线规则推理；三者并行取证后交由 LLM 生成答案。'
  }
  10 = @{
    'Text 6' = '44 篇已入库文献'
    'Text 29' = '词典正则发现实体 + BERT-NER 补漏'
    'Text 33' = '仅在已发现实体间由 LLM 抽取；类型白名单校验'
    'Text 37' = '属性图 · 7类节点 · 8类关系'
    'Text 43' = 'BELONGS_TO / LIES_IN 闭包 · 规则补边 · inferred:true'
  }
  11 = @{
    'Text 5' = '自然语言 · 当前问题'
    'Text 9' = 'nodejieba 分词 · 检索模式与空间意图'
    'Text 22' = '关键词 → 图谱关系匹配'
    'Text 24' = 'Neo4j 一跳路径 + 已物化 inferred 边'
    'Text 29' = '证据并列：RAG 原文 + KG 路径 + 可选空间结果'
    'Text 33' = '原文片段（标题/页码）+ 关系路径 + 问题'
    'Text 37' = 'DeepSeek 主模型；非流式可切备用'
    'Text 40' = 'meta → chunk → done 逐段返回；来源卡与关系数据一并回传'
  }
  12 = @{
    'Text 1' = '03   关键技术：受控关系抽取 + OWL 离线推理'
    'Text 5' = '混合实体与关系抽取（五类地质实体）'
    'Text 8' = '词典术语 + Neo4j 种子词，最长优先匹配，先稳定发现主体实体'
    'Text 11' = 'bert-base-chinese 微调，仅在词典覆盖较弱的地质页面补漏'
    'Text 14' = 'LLM 仅在已发现实体间抽关系，再由类型白名单验证'
    'Text 15' = '实体先确定、关系再校验，避免自由生成直接写入图谱'
    'Text 18' = 'OWL：读取图谱 → 规则推理 → 差分回写'
    'Text 19' = '从 Neo4j 读取显式实体与关系；BELONGS_TO / LIES_IN 做传递闭包；ASSOCIATED_WITH 补反向；FORMED_IN 向父级年代传播；HermiT 进行分类推理；新增关系与原始关系取差后，以 inferred:true 写回 Neo4j。'
    'Text 21' = '将规则可证明的多跳语义物化为直接边；在线 KG 查询会携带 inferred 标记，不把推理结果伪装为原文直接关系。'
  }
  14 = @{
    'Text 20' = '系统先返回 Top-K 文献片段与图谱关系，再由模型基于这些证据组织回答。完成后可展示关键实体、来源文档和页码。'
    'Text 22' = '来源格式：文档标题 + 页码（实际查询结果返回）'
    'Text 30' = 'BGE / TF-IDF 文献召回 + 图谱关系路径，并行编排'
    'Text 38' = 'meta / 文字 chunk / done 逐段返回；当前请求不传入完整历史消息'
  }
  16 = @{
    'Text 8' = '知识库管理 · Admin Console（界面示意）'
    'Text 10' = '44'
    'Text 13' = '3454'
    'Text 16' = '实时'
    'Text 17' = '图谱节点统计'
    'Text 57' = 'PDF 上传后后台触发增量预处理管线'
    'Text 58' = '上传校验后执行解析、切片、索引、图谱与推理；接口不等待管线完成'
    'Text 66' = 'RAG 模式、Top-K、路径权重等运行参数'
  }
  18 = @{
    'Text 6' = 'RAG 文献证据 + 图谱关系证据'
    'Text 7' = 'RAG 返回带页码的语义相似原文，Neo4j 返回实体关系路径；两类证据并行进入提示词，兼顾文献溯源与结构化关联。'
    'Text 11' = '离线本体推理增强'
    'Text 12' = '从 Neo4j 显式关系构建 OWL，对年代/空间包含关系做传递闭包，并将新增关系以 inferred:true 回写；不凭空生成地质事实。'
    'Text 16' = '模型调用与证据兜底'
    'Text 17' = '非流式优先主模型、可尝试备用模型；流式主模型失败时返回已检索证据的兜底文本，避免无依据中断。'
    'Text 21' = '低耦合、可配置的处理链路'
    'Text 22' = '解析、检索、图谱、生成通过 HTTP 与统一数据结构衔接；迁移到新领域时需替换领域词典、实体类型和推理规则。'
  }
}

function Set-ShapeText {
  param(
    [System.Xml.XmlElement]$Shape,
    [System.Xml.XmlNamespaceManager]$Ns,
    [string]$Value
  )
  $textNodes = @($Shape.SelectNodes('.//a:t', $Ns))
  if ($textNodes.Count -eq 0) { return }
  $textNodes[0].InnerText = $Value
  for ($i = 1; $i -lt $textNodes.Count; $i += 1) {
    $textNodes[$i].InnerText = ''
  }
}

function Write-ZipXml {
  param(
    [System.IO.Compression.ZipArchive]$Zip,
    [string]$EntryName,
    [xml]$Xml
  )
  $oldEntry = $Zip.GetEntry($EntryName)
  if (-not $oldEntry) { throw "PPTX entry not found: $EntryName" }
  $oldEntry.Delete()
  $newEntry = $Zip.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
  $writer = New-Object IO.StreamWriter($newEntry.Open(), (New-Object Text.UTF8Encoding($false)))
  $Xml.Save($writer)
  $writer.Close()
}

$zip = [System.IO.Compression.ZipFile]::Open($output, [System.IO.Compression.ZipArchiveMode]::Update)
try {
  foreach ($slideNumber in $replacements.Keys) {
    $entryName = "ppt/slides/slide$slideNumber.xml"
    $entry = $zip.GetEntry($entryName)
    if (-not $entry) { throw "Slide entry not found: $entryName" }

    $reader = New-Object IO.StreamReader($entry.Open())
    [xml]$xml = $reader.ReadToEnd()
    $reader.Close()

    $ns = New-Object Xml.XmlNamespaceManager($xml.NameTable)
    $ns.AddNamespace('p', 'http://schemas.openxmlformats.org/presentationml/2006/main')
    $ns.AddNamespace('a', 'http://schemas.openxmlformats.org/drawingml/2006/main')
    $shapeByName = @{}
    foreach ($shape in $xml.SelectNodes('//p:sp', $ns)) {
      $nameNode = $shape.SelectSingleNode('./p:nvSpPr/p:cNvPr', $ns)
      if ($nameNode) { $shapeByName[$nameNode.GetAttribute('name')] = $shape }
    }

    foreach ($shapeName in $replacements[$slideNumber].Keys) {
      if (-not $shapeByName.ContainsKey($shapeName)) {
        throw "Slide $slideNumber is missing shape: $shapeName"
      }
      Set-ShapeText -Shape $shapeByName[$shapeName] -Ns $ns -Value $replacements[$slideNumber][$shapeName]
    }

    Write-ZipXml -Zip $zip -EntryName $entryName -Xml $xml
  }

  # Remove six divider slides from the presentation order. Their XML files remain
  # in the package as a recovery copy, but PowerPoint presents a 16-slide deck.
  $presentationEntry = $zip.GetEntry('ppt/presentation.xml')
  $presentationReader = New-Object IO.StreamReader($presentationEntry.Open())
  [xml]$presentationXml = $presentationReader.ReadToEnd()
  $presentationReader.Close()
  $presentationNs = New-Object Xml.XmlNamespaceManager($presentationXml.NameTable)
  $presentationNs.AddNamespace('p', 'http://schemas.openxmlformats.org/presentationml/2006/main')
  $presentationNs.AddNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  $slideIdList = $presentationXml.SelectSingleNode('/p:presentation/p:sldIdLst', $presentationNs)
  $slideIds = @($slideIdList.SelectNodes('./p:sldId', $presentationNs))
  $dividerIndexes = @(19, 16, 12, 8, 4, 2) # zero-based, descending: original slides 20,17,13,9,5,3
  $removedRelationshipIds = @()
  foreach ($index in $dividerIndexes) {
    $slideId = $slideIds[$index]
    $removedRelationshipIds += $slideId.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $slideIdList.RemoveChild($slideId) | Out-Null
  }
  $sectionList = $presentationXml.SelectSingleNode('/p:presentation/p:sectionLst', $presentationNs)
  if ($sectionList) { $sectionList.ParentNode.RemoveChild($sectionList) | Out-Null }
  Write-ZipXml -Zip $zip -EntryName 'ppt/presentation.xml' -Xml $presentationXml

  $relsEntry = $zip.GetEntry('ppt/_rels/presentation.xml.rels')
  $relsReader = New-Object IO.StreamReader($relsEntry.Open())
  [xml]$relsXml = $relsReader.ReadToEnd()
  $relsReader.Close()
  foreach ($relationship in @($relsXml.Relationships.Relationship)) {
    if ($removedRelationshipIds -contains $relationship.Id) {
      $relsXml.Relationships.RemoveChild($relationship) | Out-Null
    }
  }
  Write-ZipXml -Zip $zip -EntryName 'ppt/_rels/presentation.xml.rels' -Xml $relsXml
}
finally {
  $zip.Dispose()
}

Write-Output $output
