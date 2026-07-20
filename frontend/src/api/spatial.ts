import request from './request'
import type { GeoPoint, GeoPolyline, ProspectivityGridResult, SpatialData, SpatialFeature, SpatialQueryResponse } from '@/types'

export interface SpatialQueryParams {
  keyword?: string
  question?: string
  entityTypes?: string[]
  bbox?: [number, number, number, number]
  center?: [number, number]
  radiusKm?: number
  sortBy?: 'distance' | 'name' | 'score'
  includeMock?: boolean
}

export async function querySpatial(params: SpatialQueryParams): Promise<SpatialQueryResponse> {
  return request.post('/spatial/query', params)
}

export async function queryProspectivityGrid(params: {
  question: string
  gridSizeKm: 5 | 10 | 20
  minimumScore?: number
  bbox?: [number, number, number, number]
}): Promise<ProspectivityGridResult> {
  return request.post('/spatial/grid', params)
}

/** Convert the generic GeoJSON-like query response into the map renderer contract. */
export function featuresToSpatialData(features: SpatialFeature[]): SpatialData {
  const markers: GeoPoint[] = []
  const polylines: GeoPolyline[] = []

  for (const feature of features) {
    const {
      name, entityType, description, id, region, mineralKind, era, depositType,
      owlTypes, isAnchor, isMock, evidence, distanceKm, nearestStructureKm,
      prospectivity,
    } = feature.properties
    if (feature.type === 'Point' && Array.isArray(feature.coordinates) && feature.coordinates.length >= 2) {
      const [lng, lat] = feature.coordinates as number[]
      if (typeof lng === 'number' && typeof lat === 'number') {
        markers.push({
          id: id || name, name, type: entityType, lng, lat, detail: description,
          region, mineralKind, era, depositType, owlTypes, isAnchor, isMock,
          evidence, distanceKm, nearestStructureKm, prospectivity,
        })
      }
      continue
    }

    if (feature.type === 'LineString' && Array.isArray(feature.coordinates)) {
      const path = (feature.coordinates as number[][])
        .filter((coord) => Array.isArray(coord) && coord.length >= 2)
        .map(([lng, lat]) => [Number(lng), Number(lat)] as [number, number])
        .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
      if (path.length >= 2) {
        polylines.push({
          id: id || name, type: entityType, path, label: name,
          region, isMock, evidence, distanceKm,
        })
      }
    }
  }

  return { markers, polylines }
}
