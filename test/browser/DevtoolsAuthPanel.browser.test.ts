import { expect, test } from 'vitest'
import { render } from 'vitest-browser-vue'

import type { EnhancedAuthState } from '../../src/runtime/devtools/types'
import AuthPanel from '../../src/runtime/devtools/ui/components/AuthPanel.vue'

function authState(user: EnhancedAuthState['user']): EnhancedAuthState {
  return { isAuthenticated: true, pending: false, user } as EnhancedAuthState
}

test('<AuthPanel> identifies a user whose session token carries only the ID', () => {
  // Default session claims: no name, email, or image.
  render(AuthPanel, { props: { authState: authState({ id: 'user_k57abc' }) } })

  expect(document.querySelector('.user-name')?.textContent?.trim()).toBe('user_k57abc')
  expect(document.querySelector('.avatar')?.textContent?.trim()).toBe('U')
  expect(document.querySelector('.user-email')).toBeNull()
  expect(document.body.textContent).not.toContain('Unknown')
})

test('<AuthPanel> shows profile claims when defineSessionClaims adds them', () => {
  render(AuthPanel, {
    props: {
      authState: authState({
        id: 'user_1',
        name: 'Ada',
        email: 'ada@example.com',
      }),
    },
  })

  expect(document.querySelector('.user-name')?.textContent?.trim()).toBe('Ada')
  expect(document.querySelector('.avatar')?.textContent?.trim()).toBe('A')
  expect(document.querySelector('.user-email')?.textContent?.trim()).toBe('ada@example.com')
})
