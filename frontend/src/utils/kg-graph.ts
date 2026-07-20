import type { GraphEdge, GraphNode, Subgraph } from '@/api/kg'

export function sanitizeSubgraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  maxNodes = 40,
): Subgraph {
  const uniqueNodes: GraphNode[] = []
  const seenNodeIds = new Set<string>()

  for (const node of nodes) {
    if (seenNodeIds.has(node.id)) continue
    seenNodeIds.add(node.id)
    uniqueNodes.push(node)
  }

  const retainedNodes = uniqueNodes.slice(0, Math.max(0, maxNodes))
  const retainedNodeIds = new Set(retainedNodes.map((node) => node.id))
  const seenEdges = new Set<string>()
  const retainedEdges = edges.filter((edge) => {
    if (!retainedNodeIds.has(edge.source) || !retainedNodeIds.has(edge.target)) return false

    const key = `${edge.source}|${edge.target}|${edge.label}|${Boolean(edge.inferred)}`
    if (seenEdges.has(key)) return false
    seenEdges.add(key)
    return true
  })

  return { nodes: retainedNodes, edges: retainedEdges }
}
