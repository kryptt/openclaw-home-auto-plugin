import { describe, expect } from 'vitest'
import { it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { TelegramNotifier } from '../services/TelegramNotifier.js'

const sentMessages: string[] = []

const TestNotifier = Layer.succeed(TelegramNotifier, {
  sendAlert: (message) => {
    sentMessages.push(message)
    return Effect.succeed(true)
  }
})

describe('TelegramNotifier', () => {
  it.layer(TestNotifier)('sends alert messages', (it) => {
    it.effect('records sent message', () =>
      Effect.gen(function * () {
        sentMessages.length = 0
        const notifier = yield * TelegramNotifier
        const sent = yield * notifier.sendAlert('Kitchen temperature spike!')
        expect(sent).toBe(true)
        expect(sentMessages).toContain('Kitchen temperature spike!')
      })
    )
  })
})
