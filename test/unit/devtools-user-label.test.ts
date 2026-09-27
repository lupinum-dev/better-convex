import { describe, expect, it } from 'vitest'

import { userDisplayName } from '../../src/runtime/devtools/ui/user-label'

describe('devtools user label', () => {
  it('falls back to the user ID when the session token has no profile claims', () => {
    expect(userDisplayName({ id: 'user_k57abc' })).toBe('user_k57abc')
  })

  it('prefers name, then email', () => {
    expect(userDisplayName({ id: 'u', name: 'Ada', email: 'ada@example.com' })).toBe('Ada')
    expect(userDisplayName({ id: 'u', email: 'ada@example.com' })).toBe('ada@example.com')
  })

  it('returns an empty label without a user', () => {
    expect(userDisplayName(null)).toBe('')
  })
})
