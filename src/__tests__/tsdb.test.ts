import { describe, expect } from 'vitest'
import { it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { TsdbService } from '../services/TsdbService.js'
import type { SensorReading, SensorBaseline } from '../services/TsdbService.js'

const mkTestTsdb = (opts?: {
  history?: SensorReading[]
  baseline?: SensorBaseline | null
  entities?: Array<{ entity_id: string, count: number }>
}) => Layer.succeed(TsdbService, {
  querySensorHistory: () => Effect.succeed(opts?.history ?? []),
  computeBaseline: () => Effect.succeed(opts?.baseline ?? null),
  listEntities: () => Effect.succeed(opts?.entities ?? [])
})

describe('TsdbService', () => {
  const reading: SensorReading = {
    time: '2026-04-09T12:00:00Z',
    entity_id: 'sensor.kitchen_temperature',
    state: '21.5'
  }

  const baseline: SensorBaseline = {
    entity_id: 'sensor.kitchen_temperature',
    mean: 21.5,
    stddev: 1.2,
    min: 18.0,
    max: 25.0,
    count: 1000,
    window_days: 7
  }

  it.layer(mkTestTsdb({ history: [reading] }))('querySensorHistory returns readings', (it) => {
    it.effect('returns mock readings', () =>
      Effect.gen(function * () {
        const tsdb = yield * TsdbService
        const results = yield * tsdb.querySensorHistory('sensor.kitchen_temperature', 24)
        expect(results).toHaveLength(1)
        expect(results[0]!.state).toBe('21.5')
      })
    )
  })

  it.layer(mkTestTsdb({ baseline }))('computeBaseline returns statistics', (it) => {
    it.effect('returns baseline', () =>
      Effect.gen(function * () {
        const tsdb = yield * TsdbService
        const result = yield * tsdb.computeBaseline('sensor.kitchen_temperature')
        expect(result).not.toBeNull()
        expect(result!.mean).toBe(21.5)
        expect(result!.stddev).toBe(1.2)
      })
    )
  })

  it.layer(mkTestTsdb())('computeBaseline returns null when no data', (it) => {
    it.effect('returns null', () =>
      Effect.gen(function * () {
        const tsdb = yield * TsdbService
        const result = yield * tsdb.computeBaseline('sensor.nonexistent')
        expect(result).toBeNull()
      })
    )
  })

  it.layer(mkTestTsdb({ entities: [{ entity_id: 'sensor.power', count: 5000 }] }))('listEntities returns entities', (it) => {
    it.effect('returns entity list', () =>
      Effect.gen(function * () {
        const tsdb = yield * TsdbService
        const results = yield * tsdb.listEntities()
        expect(results).toHaveLength(1)
        expect(results[0]!.entity_id).toBe('sensor.power')
      })
    )
  })
})
