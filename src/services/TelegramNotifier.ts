import { Context, Effect, Layer } from 'effect'
import { NotifyError } from '../errors.js'
import { DEFAULT_NOTIFICATION_RATE_LIMIT_MS } from '../config.js'

export interface TelegramNotifierShape {
  readonly sendAlert: (
    message: string
  ) => Effect.Effect<boolean, NotifyError>
}

export class TelegramNotifier extends Context.Tag('TelegramNotifier')<
  TelegramNotifier,
  TelegramNotifierShape
>() {}

export const TelegramNotifierLive = Layer.succeed(
  TelegramNotifier,
  (() => {
    const token = process.env.TELEGRAM_BOT_TOKEN ?? ''
    const chatId = process.env.TELEGRAM_NOTIFY_CHAT_ID ?? '35261635'
    const rateLimitMs = DEFAULT_NOTIFICATION_RATE_LIMIT_MS
    let lastNotifyAt = 0

    if (!token) {
      console.error('[home-auto] TELEGRAM_BOT_TOKEN not set, notifications disabled')
    }

    return {
      sendAlert: (message) =>
        Effect.gen(function * () {
          if (!token) return false

          const now = Date.now()
          if (now - lastNotifyAt < rateLimitMs) {
            console.log('[home-auto] notification throttled (rate limit)')
            return false
          }

          const res = yield * Effect.tryPromise({
            try: () => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: `🏠 ${message}`,
                parse_mode: 'Markdown'
              })
            }),
            catch: (err) => new NotifyError({ message: `Telegram send failed: ${err}` })
          })

          if (!res.ok) {
            const body = yield * Effect.tryPromise({
              try: () => res.text(),
              catch: () => new NotifyError({ message: 'Failed to read Telegram response' })
            })
            console.error(`[home-auto] Telegram API error: ${res.status} ${body}`)
            return false
          }

          lastNotifyAt = now
          return true
        })
    }
  })()
)
