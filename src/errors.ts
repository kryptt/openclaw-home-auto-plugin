import { Data } from 'effect'

export class DbError extends Data.TaggedError('DbError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class NotifyError extends Data.TaggedError('NotifyError')<{
  readonly message: string
  readonly cause?: unknown
}> {}
