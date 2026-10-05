import { expect, test } from 'vitest'
import { render } from 'vitest-browser-vue'

import type { EnhancedAuthState } from '../../src/runtime/devtools/types'
import AgentDiagnosticsPanel from '../../src/runtime/devtools/ui/components/AgentDiagnosticsPanel.vue'
import AuthPanel from '../../src/runtime/devtools/ui/components/AuthPanel.vue'
import AuthProxyPanel from '../../src/runtime/devtools/ui/components/AuthProxyPanel.vue'

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

test('both proxy panels show a 302 as redirected and exclude it from error counts', () => {
  const stats = {
    totalRequests: 1,
    successCount: 0,
    errorCount: 0,
    avgDuration: 0,
    recentRequests: [
      {
        id: 'redirect',
        method: 'GET',
        path: '/oauth/authorize',
        status: 302,
        success: false,
        timestamp: 0,
      },
    ],
  }
  render(AuthProxyPanel, { props: { stats } })
  render(AgentDiagnosticsPanel, { props: { stats } })
  expect(document.querySelectorAll('.badge.pending')).toHaveLength(2)
  expect(document.querySelectorAll('.badge.error')).toHaveLength(0)
  expect(document.body.textContent).toContain('redirected')
  const counts = [...document.querySelectorAll('.proxy-stat')].map((node) =>
    node.textContent?.replace(/\s+/g, ' ').trim(),
  )
  expect(counts).toContain('1Redirects')
  expect(counts).toContain('0Errors')
})
