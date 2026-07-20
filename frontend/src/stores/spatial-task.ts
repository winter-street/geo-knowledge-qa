import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { MapActionType, MapPlan, SpatialAnalysis, SpatialData } from '@/types'
import {
  reduceMapPlan,
  type MapActionStatus,
  type SpatialTaskSnapshot,
} from '@/utils/map-plan'

const STORAGE_KEY = 'geo-spatial-task'

function loadSnapshot(): SpatialTaskSnapshot | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null')
    return value?.planId && value?.plan?.version === 1 ? value : null
  } catch {
    return null
  }
}

export const useSpatialTaskStore = defineStore('spatial-task', () => {
  const snapshot = ref<SpatialTaskSnapshot | null>(loadSnapshot())

  const planId = computed(() => snapshot.value?.planId ?? '')
  const plan = computed(() => snapshot.value?.plan)

  function persist() {
    if (typeof sessionStorage === 'undefined') return
    if (snapshot.value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot.value))
    else sessionStorage.removeItem(STORAGE_KEY)
  }

  function accept(mapPlan: MapPlan, data?: SpatialData, analysis?: SpatialAnalysis) {
    const reduced = reduceMapPlan(mapPlan, snapshot.value ?? undefined)
    snapshot.value = {
      ...reduced,
      plan: mapPlan,
      ...(data ? { data } : reduced.data ? { data: reduced.data } : {}),
      ...(analysis ? { analysis } : reduced.analysis ? { analysis: reduced.analysis } : {}),
    }
    persist()
  }

  function markAction(type: MapActionType, status: MapActionStatus, message?: string) {
    if (!snapshot.value) return
    const index = snapshot.value.actionResults.findIndex((item) => item.type === type && item.status === 'pending')
    if (index < 0) return
    const results = [...snapshot.value.actionResults]
    results[index] = { ...results[index]!, status, ...(message ? { message } : {}) }
    snapshot.value = { ...snapshot.value, actionResults: results }
    persist()
  }

  function clear() {
    snapshot.value = null
    persist()
  }

  return { snapshot, planId, plan, accept, markAction, clear }
})
