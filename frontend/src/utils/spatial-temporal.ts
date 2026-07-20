import type { GeoPoint, SpatialData } from '@/types'

export function markerHasEra(marker: GeoPoint, era: string): boolean {
  return String(marker.era || '')
    .split(/\s*(?:\/|、|,|，|;|；)\s*/)
    .map((item) => item.trim())
    .includes(era)
}

export function filterSpatialDataByEra(data: SpatialData, era: string | null): SpatialData {
  return filterSpatialData(data, { era })
}

export function filterSpatialData(
  data: SpatialData,
  filters: { era?: string | null; region?: string | null },
): SpatialData {
  const { era = null, region = null } = filters
  return {
    markers: (data.markers || []).filter((marker) =>
      (!region || marker.region === region) && (!era || markerHasEra(marker, era)),
    ),
    polylines: (data.polylines || []).filter((line) => !region || line.region === region),
  }
}
