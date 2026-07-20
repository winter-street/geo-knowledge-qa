export const CHINA_MAP_CENTER: [number, number] = [104.2, 35.8]
export const CHINA_MAP_ZOOM_RANGE: [number, number] = [4, 18]

export const CHINA_MAP_BOUNDS = {
  southWest: [73.5, 3.5] as [number, number],
  northEast: [135.1, 53.6] as [number, number],
}

function coordinate(value: any, field: 'lng' | 'lat'): number {
  const getter = field === 'lng' ? 'getLng' : 'getLat'
  return Number(value?.[field] ?? value?.[getter]?.())
}

/** Restrict the map center to China's geographic extent. */
export function applyChinaMapConstraints(AMap: any, map: any): void {
  if (!AMap || !map) return

  const { southWest, northEast } = CHINA_MAP_BOUNDS
  if (typeof AMap.Bounds === 'function' && typeof map.setLimitBounds === 'function') {
    try {
      map.setLimitBounds(new AMap.Bounds(southWest, northEast))
      return
    } catch {
      // Fall through to center clamping for older or partial JSAPI builds.
    }
  }

  // Compatibility fallback for map builds without setLimitBounds.
  map.on?.('moveend', () => {
    const center = map.getCenter?.()
    const lng = coordinate(center, 'lng')
    const lat = coordinate(center, 'lat')
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return

    const nextLng = Math.min(northEast[0], Math.max(southWest[0], lng))
    const nextLat = Math.min(northEast[1], Math.max(southWest[1], lat))
    if (nextLng !== lng || nextLat !== lat) map.setCenter?.([nextLng, nextLat])
  })
}
