import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode } from '@/api/kg'
import { sanitizeSubgraph } from './kg-graph'

const node = (id: string): GraphNode => ({ id, label: `节点${id}`, type: 'Mineral' })
const edge = (source: string, target: string, label = '关联', inferred = false): GraphEdge => ({
  source,
  target,
  label,
  inferred,
})

describe('sanitizeSubgraph', () => {
  it('removes edges to the 41st node after applying the 40-node limit', () => {
    const nodes = Array.from({ length: 41 }, (_, index) => node(String(index + 1)))
    const result = sanitizeSubgraph(nodes, [edge('1', '40'), edge('1', '41')])

    expect(result.nodes).toHaveLength(40)
    expect(result.nodes.at(-1)?.id).toBe('40')
    expect(result.edges).toEqual([edge('1', '40')])
  })

  it('keeps edges whose endpoints are both retained', () => {
    expect(sanitizeSubgraph([node('1'), node('2')], [edge('1', '2')])).toEqual({
      nodes: [node('1'), node('2')],
      edges: [edge('1', '2')],
    })
  })

  it('deduplicates nodes and identical edges while preserving order', () => {
    const inferred = edge('2', '1', '推理关联', true)
    const result = sanitizeSubgraph(
      [node('1'), node('1'), node('2')],
      [edge('1', '2'), edge('1', '2'), inferred, inferred],
    )

    expect(result).toEqual({
      nodes: [node('1'), node('2')],
      edges: [edge('1', '2'), inferred],
    })
  })

  it('does not mutate input arrays', () => {
    const nodes = [node('1'), node('1'), node('2')]
    const edges = [edge('1', '2'), edge('1', '3')]
    const originalNodes = structuredClone(nodes)
    const originalEdges = structuredClone(edges)

    sanitizeSubgraph(nodes, edges, 2)

    expect(nodes).toEqual(originalNodes)
    expect(edges).toEqual(originalEdges)
  })

  it('returns an empty subgraph when maxNodes is zero', () => {
    expect(sanitizeSubgraph([node('1')], [edge('1', '1')], 0)).toEqual({ nodes: [], edges: [] })
  })
})
