import { Effect, Layer, Exit } from 'effect'
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import { TsdbService, TsdbServiceLive } from './services/TsdbService.js'
import { TelegramNotifier, TelegramNotifierLive } from './services/TelegramNotifier.js'
import { HA_KEYWORDS } from './config.js'
import { DEFAULT_ANOMALY_Z_SCORE } from './config.js'

type AppServices = TsdbService | TelegramNotifier

// Noop layers for graceful degradation
const noopTsdbLayer = Layer.succeed(TsdbService, {
  querySensorHistory: () => Effect.succeed([]),
  computeBaseline: () => Effect.succeed(null),
  listEntities: () => Effect.succeed([])
})

const noopNotifierLayer = Layer.succeed(TelegramNotifier, {
  sendAlert: () => Effect.succeed(false)
})

let appLayer = Layer.mergeAll(noopTsdbLayer, TelegramNotifierLive)
let tsdbReady = false

const initTsdb = async (): Promise<void> => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function * () {
      const tsdb = yield * TsdbService
      // Quick connectivity test
      yield * tsdb.listEntities(1)
    }).pipe(Effect.provide(TsdbServiceLive))
  )
  if (Exit.isSuccess(exit)) {
    const safeTsdbLayer = Layer.catchAll(TsdbServiceLive, () => noopTsdbLayer)
    appLayer = Layer.mergeAll(safeTsdbLayer, TelegramNotifierLive)
    tsdbReady = true
    console.log('[home-auto] TimescaleDB connected')
  } else {
    console.error('[home-auto] TimescaleDB unavailable, history tools disabled')
  }
}

const run = <A>(
  effect: Effect.Effect<A, unknown, AppServices>
): Promise<A | undefined> =>
    Effect.runPromise(effect.pipe(
      Effect.provide(appLayer),
      Effect.catchAll((err) => {
        console.error('[home-auto] effect failed:', err)
        return Effect.succeed(undefined as A | undefined)
      })
    ))

export default definePluginEntry({
  id: 'openclaw-home-auto-plugin',
  name: 'Home Auto',
  description: 'Home Assistant integration with TimescaleDB historical queries, anomaly detection, and Telegram notifications',
  // No kind — this is a general-purpose plugin, not a memory plugin

  register (api) {
    // ha_history tool — query TimescaleDB LTSS
    api.registerTool({
      name: 'ha_history',
      label: 'HA Sensor History',
      description: 'Query historical sensor data from TimescaleDB LTSS. Returns timestamped readings for a specific entity.',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string', description: 'HA entity ID (e.g. sensor.kitchen_temperature)' },
          hours: { type: 'number', description: 'Number of hours of history (default 24)' }
        },
        required: ['entity_id']
      },
      async execute (...rawArgs: any[]) {
        const args = (typeof rawArgs[0] === 'object' && rawArgs[0] !== null ? rawArgs[0] : rawArgs[1] ?? {}) as { entity_id: string, hours?: number }
        try {
          const readings = await run(
            Effect.gen(function * () {
              const tsdb = yield * TsdbService
              return yield * tsdb.querySensorHistory(args.entity_id, args.hours ?? 24)
            })
          )
          if (!readings?.length) {
            return { content: [{ type: 'text', text: `No data found for ${args.entity_id} in the last ${args.hours ?? 24} hours.` }] }
          }
          const lines = readings.slice(0, 20).map((r) =>
            `${r.time}: ${r.state}`
          )
          return { content: [{ type: 'text', text: `${args.entity_id} — ${readings.length} readings (showing latest 20):\n${lines.join('\n')}` }] }
        } catch (e) {
          return { content: [{ type: 'text', text: `History query failed: ${e}` }] }
        }
      }
    })

    // ha_baseline tool — compute statistical baseline
    api.registerTool({
      name: 'ha_baseline',
      label: 'HA Sensor Baseline',
      description: 'Compute mean, stddev, min, max for a numeric sensor over a time window. Use to understand normal ranges.',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string', description: 'HA entity ID (must be numeric sensor)' },
          window_days: { type: 'number', description: 'Window in days for baseline computation (default 7)' }
        },
        required: ['entity_id']
      },
      async execute (...rawArgs: any[]) {
        const args = (typeof rawArgs[0] === 'object' && rawArgs[0] !== null ? rawArgs[0] : rawArgs[1] ?? {}) as { entity_id: string, window_days?: number }
        try {
          const baseline = await run(
            Effect.gen(function * () {
              const tsdb = yield * TsdbService
              return yield * tsdb.computeBaseline(args.entity_id, args.window_days)
            })
          )
          if (!baseline) {
            return { content: [{ type: 'text', text: `No numeric data found for ${args.entity_id}. The sensor may not report numeric values.` }] }
          }
          return { content: [{ type: 'text', text: `Baseline for ${baseline.entity_id} (${baseline.window_days}d window, ${baseline.count} readings):\n  Mean: ${baseline.mean.toFixed(2)}\n  Std Dev: ${baseline.stddev.toFixed(2)}\n  Min: ${baseline.min}\n  Max: ${baseline.max}` }] }
        } catch (e) {
          return { content: [{ type: 'text', text: `Baseline computation failed: ${e}` }] }
        }
      }
    })

    // ha_anomalies tool — detect unusual readings
    api.registerTool({
      name: 'ha_anomalies',
      label: 'HA Anomaly Check',
      description: 'Compare a sensor current value against its historical baseline. Flags readings outside the z-score threshold as anomalous.',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string', description: 'HA entity ID to check' },
          current_value: { type: 'number', description: 'Current sensor value to check against baseline' },
          threshold: { type: 'number', description: 'Z-score threshold (default 2.0)' }
        },
        required: ['entity_id', 'current_value']
      },
      async execute (...rawArgs: any[]) {
        const args = (typeof rawArgs[0] === 'object' && rawArgs[0] !== null ? rawArgs[0] : rawArgs[1] ?? {}) as { entity_id: string, current_value: number, threshold?: number }
        try {
          const baseline = await run(
            Effect.gen(function * () {
              const tsdb = yield * TsdbService
              return yield * tsdb.computeBaseline(args.entity_id)
            })
          )
          if (!baseline || baseline.stddev === 0) {
            return { content: [{ type: 'text', text: `Cannot assess anomaly for ${args.entity_id}: insufficient baseline data.` }] }
          }
          const zScore = Math.abs(args.current_value - baseline.mean) / baseline.stddev
          const threshold = args.threshold ?? DEFAULT_ANOMALY_Z_SCORE
          const isAnomaly = zScore > threshold
          const status = isAnomaly ? '⚠️ ANOMALOUS' : '✅ Normal'
          return { content: [{ type: 'text', text: `${status}: ${args.entity_id} = ${args.current_value}\n  Baseline mean: ${baseline.mean.toFixed(2)} ± ${baseline.stddev.toFixed(2)}\n  Z-score: ${zScore.toFixed(2)} (threshold: ${threshold})` }] }
        } catch (e) {
          return { content: [{ type: 'text', text: `Anomaly check failed: ${e}` }] }
        }
      }
    })

    // ha_notify tool — send Telegram notification
    api.registerTool({
      name: 'ha_notify',
      label: 'HA Notify',
      description: 'Send a proactive Telegram notification about a home automation event. Rate-limited to 1 per 30 seconds.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Notification message to send' }
        },
        required: ['message']
      },
      async execute (...rawArgs: any[]) {
        const args = (typeof rawArgs[0] === 'object' && rawArgs[0] !== null ? rawArgs[0] : rawArgs[1] ?? {}) as { message: string }
        try {
          const sent = await run(
            Effect.gen(function * () {
              const notifier = yield * TelegramNotifier
              return yield * notifier.sendAlert(args.message)
            })
          )
          return { content: [{ type: 'text', text: sent ? 'Notification sent.' : 'Notification not sent (rate-limited or disabled).' }] }
        } catch (e) {
          return { content: [{ type: 'text', text: `Notification failed: ${e}` }] }
        }
      }
    })

    // Context injection — add home context when HA-related keywords detected
    api.on('before_prompt_build', async (event: any) => {
      try {
        if (!tsdbReady) return {}

        // Extract user message
        let msg = ''
        const msgs: any[] = event?.messages ?? []
        const userMsgs = msgs.filter((m: any) => m.role === 'user')
        if (userMsgs.length) {
          const last = userMsgs[userMsgs.length - 1]
          const content = last.content
          if (typeof content === 'string') msg = content
          else if (Array.isArray(content)) {
            msg = content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ')
          }
        }
        if (!msg && typeof event?.prompt === 'string') msg = event.prompt

        // Only inject for HA-related queries
        const lower = msg.toLowerCase()
        const haRelevant = HA_KEYWORDS.some((kw) => lower.includes(kw))
        if (!haRelevant) return {}

        // Get top entities as context
        const entities = await run(
          Effect.gen(function * () {
            const tsdb = yield * TsdbService
            return yield * tsdb.listEntities(10)
          })
        )
        if (!entities?.length) return {}

        const lines = entities.map((e) => `  ${e.entity_id} (${e.count} readings/7d)`).join('\n')
        return {
          prependContext: [
            '<home-context>',
            'TimescaleDB has historical data for these top entities:',
            lines,
            'Use ha_history, ha_baseline, ha_anomalies tools for detailed analysis.',
            'Use Home Assistant MCP tools (HassTurnOn, HassTurnOff, HassLightSet, etc.) for device control.',
            '</home-context>'
          ].join('\n')
        }
      } catch {
        return {}
      }
    })

    // Initialize TimescaleDB connection (non-blocking)
    initTsdb().catch((err) => console.error('[home-auto] initTsdb failed:', err))

    console.log('[home-auto] registered 4 tools + context hook')
  }
})
