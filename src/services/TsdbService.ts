import { Context, Effect, Layer } from 'effect'
import { DbError } from '../errors.js'
import { DEFAULT_BASELINE_WINDOW_DAYS, MAX_HISTORY_POINTS } from '../config.js'

export interface SensorReading {
  readonly time: string
  readonly entity_id: string
  readonly state: string
  readonly attributes?: Record<string, unknown>
}

export interface SensorBaseline {
  readonly entity_id: string
  readonly mean: number
  readonly stddev: number
  readonly min: number
  readonly max: number
  readonly count: number
  readonly window_days: number
}

export interface TsdbServiceShape {
  readonly querySensorHistory: (
    entityId: string,
    hours: number
  ) => Effect.Effect<SensorReading[], DbError>

  readonly computeBaseline: (
    entityId: string,
    windowDays?: number
  ) => Effect.Effect<SensorBaseline | null, DbError>

  readonly listEntities: (
    limit?: number
  ) => Effect.Effect<Array<{ entity_id: string, count: number }>, DbError>
}

export class TsdbService extends Context.Tag('TsdbService')<
  TsdbService,
  TsdbServiceShape
>() {}

export const TsdbServiceLive = Layer.effect(
  TsdbService,
  Effect.gen(function * () {
    const connStr = process.env.TSDB_URL ?? ''
    if (!connStr) {
      console.error('[home-auto] TSDB_URL not set, TimescaleDB disabled')
      return yield * Effect.fail(new DbError({ message: 'TSDB_URL not configured' }))
    }

    const pg = yield * Effect.tryPromise({
      try: () => import('pg'),
      catch: (err) => new DbError({ message: `Failed to import pg: ${err}` })
    })

    const Client = pg.default ? pg.default.Client : pg.Client
    const client = new Client({ connectionString: connStr })

    yield * Effect.tryPromise({
      try: () => client.connect(),
      catch: (err) => new DbError({ message: `TSDB connect failed: ${err}` })
    })

    const query = (
      sql: string,
      params?: unknown[]
    ): Effect.Effect<{ rows: Record<string, unknown>[] }, DbError> =>
      Effect.tryPromise({
        try: () => client.query(sql, params),
        catch: (err) => new DbError({ message: `TSDB query failed: ${err}`, cause: err })
      })

    return {
      querySensorHistory: (entityId, hours) =>
        Effect.gen(function * () {
          const res = yield * query(
            `SELECT time, entity_id, state, attributes
             FROM ltss
             WHERE entity_id = $1 AND time > now() - make_interval(hours => $2)
             ORDER BY time DESC
             LIMIT $3`,
            [entityId, hours, MAX_HISTORY_POINTS]
          )
          return res.rows.map((r) => ({
            time: String(r.time),
            entity_id: String(r.entity_id),
            state: String(r.state),
            attributes: r.attributes as Record<string, unknown> | undefined
          }))
        }),

      computeBaseline: (entityId, windowDays) =>
        Effect.gen(function * () {
          const days = windowDays ?? DEFAULT_BASELINE_WINDOW_DAYS
          const res = yield * query(
            `SELECT
               avg(state::numeric) as mean,
               stddev(state::numeric) as stddev,
               min(state::numeric) as min,
               max(state::numeric) as max,
               count(*) as count
             FROM ltss
             WHERE entity_id = $1
               AND time > now() - make_interval(days => $2)
               AND state ~ '^-?[0-9]+(\\.[0-9]+)?$'`,
            [entityId, days]
          )
          const row = res.rows[0]
          if (!row || parseInt(String(row.count), 10) === 0) return null
          return {
            entity_id: entityId,
            mean: parseFloat(String(row.mean)),
            stddev: parseFloat(String(row.stddev ?? '0')),
            min: parseFloat(String(row.min)),
            max: parseFloat(String(row.max)),
            count: parseInt(String(row.count), 10),
            window_days: days
          }
        }),

      listEntities: (limit) =>
        Effect.gen(function * () {
          const res = yield * query(
            `SELECT entity_id, count(*) as count
             FROM ltss
             WHERE time > now() - interval '7 days'
             GROUP BY entity_id
             ORDER BY count DESC
             LIMIT $1`,
            [limit ?? 50]
          )
          return res.rows.map((r) => ({
            entity_id: String(r.entity_id),
            count: parseInt(String(r.count), 10)
          }))
        })
    }
  })
)
