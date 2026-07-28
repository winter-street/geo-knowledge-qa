$source = 'D:\1GISwork\6-GISdevelop\docs\地理知识图谱与RAG增强的智能问答系统-答辩-修订版.pptx'
$output = 'D:\1GISwork\6-GISdevelop\docs\地理知识图谱与RAG增强的智能问答系统-答辩-修订版-v2.pptx'
$svgPath = 'D:\1GISwork\6-GISdevelop\docs\assets\graph-visualization-revised.svg'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Copy-Item -LiteralPath $source -Destination $output -Force

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

$zip = [System.IO.Compression.ZipFile]::Open($output, [System.IO.Compression.ZipArchiveMode]::Update)
try {
  $mediaEntryName = 'ppt/media/graph-visualization-revised.svg'
  $mediaEntry = $zip.CreateEntry($mediaEntryName, [System.IO.Compression.CompressionLevel]::Optimal)
  $mediaStream = $mediaEntry.Open()
  $svgBytes = [IO.File]::ReadAllBytes($svgPath)
  $mediaStream.Write($svgBytes, 0, $svgBytes.Length)
  $mediaStream.Close()

  $contentReader = New-Object IO.StreamReader($zip.GetEntry('[Content_Types].xml').Open())
  [xml]$contentTypes = $contentReader.ReadToEnd()
  $contentReader.Close()
  $contentNs = 'http://schemas.openxmlformats.org/package/2006/content-types'
  $hasSvg = @($contentTypes.Types.Default | Where-Object { $_.Extension -eq 'svg' }).Count -gt 0
  if (-not $hasSvg) {
    $svgType = $contentTypes.CreateElement('Default', $contentNs)
    $svgType.SetAttribute('Extension', 'svg')
    $svgType.SetAttribute('ContentType', 'image/svg+xml')
    $contentTypes.Types.AppendChild($svgType) | Out-Null
  }
  Write-ZipXml -Zip $zip -EntryName '[Content_Types].xml' -Xml $contentTypes

  $relName = 'ppt/slides/_rels/slide15.xml.rels'
  $relsReader = New-Object IO.StreamReader($zip.GetEntry($relName).Open())
  [xml]$rels = $relsReader.ReadToEnd()
  $relsReader.Close()
  $relNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
  $imageRel = $rels.CreateElement('Relationship', $relNs)
  $imageRel.SetAttribute('Id', 'rId99')
  $imageRel.SetAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image')
  $imageRel.SetAttribute('Target', '../media/graph-visualization-revised.svg')
  $rels.Relationships.AppendChild($imageRel) | Out-Null
  Write-ZipXml -Zip $zip -EntryName $relName -Xml $rels

  $slideName = 'ppt/slides/slide15.xml'
  $slideReader = New-Object IO.StreamReader($zip.GetEntry($slideName).Open())
  [xml]$slide = $slideReader.ReadToEnd()
  $slideReader.Close()
  $ns = New-Object Xml.XmlNamespaceManager($slide.NameTable)
  $ns.AddNamespace('p', 'http://schemas.openxmlformats.org/presentationml/2006/main')
  $ns.AddNamespace('a', 'http://schemas.openxmlformats.org/drawingml/2006/main')
  $spTree = $slide.SelectSingleNode('/p:sld/p:cSld/p:spTree', $ns)
  foreach ($child in @($spTree.ChildNodes)) {
    if ($child.LocalName -notin @('nvGrpSpPr', 'grpSpPr')) {
      $spTree.RemoveChild($child) | Out-Null
    }
  }

  $fragment = $slide.CreateDocumentFragment()
  $fragment.InnerXml = @'
<p:pic xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:nvPicPr><p:cNvPr id="2000" name="Revised Graph Visualization"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
  <p:blipFill><a:blip r:embed="rId99"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
  <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>
'@
  $spTree.AppendChild($fragment.FirstChild) | Out-Null
  Write-ZipXml -Zip $zip -EntryName $slideName -Xml $slide
}
finally {
  $zip.Dispose()
}

Write-Output $output
