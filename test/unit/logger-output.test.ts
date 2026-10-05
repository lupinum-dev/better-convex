import { afterEach, expect, it, vi } from 'vitest'

import { createLogger } from '../../src/runtime/utils/logger'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// Catch info logging accidentally emitting debug/timing output, or debug timing
// changing its clock, rounding, or platform-specific console arguments.
it.each([
  {
    browser: false,
    debug: ['\x1B[36m[convex]\x1B[0m \x1B[2m[debug]\x1B[0m Ready'],
    time: ['\x1B[36m[convex]\x1B[0m \x1B[2m[time]\x1B[0m Query: 26ms'],
  },
  {
    browser: true,
    debug: [
      '%cConvex%c [debug] Ready',
      'background: #6366f1; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
      'color: #9ca3af;',
    ],
    time: [
      '%cConvex%c [time] Query: 26ms',
      'background: #6366f1; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
      'color: #9ca3af;',
    ],
  },
])('preserves debug gating and timed output (browser=$browser)', ({ browser, debug, time }) => {
  vi.stubGlobal('window', browser ? {} : undefined)
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(125.6)
  for (const level of [false, 'info'] as const) {
    const logger = createLogger(level)
    logger.debug('Ready', { ignored: true })
    logger.time('Query')()
  }
  expect(log).not.toHaveBeenCalled()
  expect(clock).not.toHaveBeenCalled()
  const logger = createLogger('debug')
  logger.debug('Ready', { ignored: true })
  logger.time('Query')()
  expect(log.mock.calls).toEqual([debug, time])
})
