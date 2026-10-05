import { ConvexError } from 'convex/values'
import { describe, expect, it } from 'vitest'

import { projectMcpToolError, runMcpTool } from '../../packages/mcp/src/tools'

describe('MCP tool failure projection', () => {
  it('preserves the official input-required result shape', async () => {
    await expect(
      runMcpTool(async () => ({
        requestState: 'opaque-state',
        resultType: 'input_required' as const,
      })),
    ).resolves.toEqual({
      requestState: 'opaque-state',
      resultType: 'input_required',
    })
  })

  it('preserves expected values and explicit safe actionable failures', async () => {
    const expected = await runMcpTool(() => ({
      content: [{ type: 'text', text: 'Entry changed; refresh before retrying.' }],
      structuredContent: { status: 'conflict' },
    }))
    expect(expected).toEqual({
      content: [{ type: 'text', text: 'Entry changed; refresh before retrying.' }],
      structuredContent: { status: 'conflict' },
    })

    const actionable = await runMcpTool(() => ({
      content: [{ type: 'text', text: 'Upstream is temporarily unavailable.' }],
      isError: true,
    }))
    expect(actionable).toEqual({
      content: [{ type: 'text', text: 'Upstream is temporarily unavailable.' }],
      isError: true,
    })
  })

  it.each([
    Object.assign(new Error('raw-upstream-response-sentinel'), {
      cause: new Error('raw-cause-sentinel'),
      data: { detail: 'raw-data-sentinel' },
      name: 'RawNameSentinel',
    }),
    {
      authorization: 'Bearer raw-token-sentinel',
      stack: 'private-stack-sentinel',
    },
    new (class RawConstructorSentinelError extends Error {})('constructor-message-sentinel'),
    'plain-throw-sentinel',
  ])('replaces unexpected throw with one static failure', async (cause) => {
    const result = await runMcpTool(() => {
      throw cause
    })
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Tool execution failed' }],
      isError: true,
    })
    const serialized = JSON.stringify(result)
    for (const sentinel of [
      'raw-upstream-response-sentinel',
      'raw-cause-sentinel',
      'raw-data-sentinel',
      'RawNameSentinel',
      'raw-token-sentinel',
      'RawConstructorSentinelError',
      'constructor-message-sentinel',
      'private-stack-sentinel',
      'plain-throw-sentinel',
    ]) {
      expect(serialized).not.toContain(sentinel)
    }
    expect(result).not.toHaveProperty('cause')
  })

  it('never inspects a hostile cause', async () => {
    let getters = 0
    const cause = Object.create(null) as Record<string, unknown>
    for (const key of ['name', 'message', 'stack', 'data', 'constructor']) {
      Object.defineProperty(cause, key, {
        get() {
          getters += 1
          throw new Error(`getter-${key}`)
        },
      })
    }
    const result = await runMcpTool(() => {
      throw cause
    })
    expect(getters).toBe(0)
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Tool execution failed' }],
      isError: true,
    })
  })

  it('reports only frozen operation metadata to a request-scoped hook', async () => {
    const observed: unknown[] = []
    const result = await runMcpTool(
      () => {
        throw new Error('raw-tool-cause-sentinel')
      },
      {
        name: 'notes.search',
        onToolError(metadata) {
          observed.push(metadata)
        },
      },
    )

    expect(result).toMatchObject({ isError: true })
    expect(observed).toEqual([{ kind: 'tool', name: 'notes.search' }])
    expect(Object.isFrozen(observed[0])).toBe(true)
    expect(JSON.stringify(observed)).not.toContain('raw-tool-cause-sentinel')
  })

  it('contains diagnostic hook failures and rejects unsafe operation names', async () => {
    await expect(
      runMcpTool(
        () => {
          throw new Error('operation')
        },
        {
          name: 'notes.search',
          onToolError() {
            throw new Error('observer-sentinel')
          },
        },
      ),
    ).resolves.toMatchObject({ isError: true })
    await expect(runMcpTool(() => ({ content: [] }), { name: 'bad\nname' })).rejects.toThrow(
      'Invalid MCP tool name',
    )
  })
})

describe('ConvexError projection', () => {
  const projected = (code: string, message: string, retryable = false) => ({
    isError: true,
    content: [{ type: 'text', text: message }],
    structuredContent: { error: { code, message, retryable } },
  })

  it('projects allowlisted codes with the developer message and retryable flag', () => {
    expect(
      projectMcpToolError(
        new ConvexError({ code: 'RATE_LIMITED', message: 'Wait a minute.', retryable: true }),
        { expose: ['RATE_LIMITED'] },
      ),
    ).toEqual(projected('RATE_LIMITED', 'Wait a minute.', true))
    expect(
      projectMcpToolError(new ConvexError('RATE_LIMITED'), { expose: ['RATE_LIMITED'] }),
    ).toEqual(projected('RATE_LIMITED', 'The request could not be completed.'))
  })

  it('always projects the Better Convex auth codes', () => {
    for (const [code, message] of Object.entries({
      UNAUTHENTICATED: 'Authentication is required.',
      MCP_ACCESS_DENIED: 'This connection is no longer allowed to access this data.',
      MCP_INSUFFICIENT_SCOPE: 'This connection lacks the permission this tool requires.',
    })) {
      expect(projectMcpToolError(new ConvexError({ code, message: `${code} message` }))).toEqual(
        projected(code, message),
      )
    }
    expect(projectMcpToolError(new ConvexError({ code: 'MCP_ACCESS_DENIED' }))).toMatchObject({
      structuredContent: { error: { code: 'MCP_ACCESS_DENIED', retryable: false } },
    })
  })

  it('hides an application UNAUTHENTICATED message unless explicitly exposed', async () => {
    const error = new ConvexError({
      code: 'UNAUTHENTICATED',
      message: 'private-account-sentinel',
      retryable: true,
    })
    await expect(
      runMcpTool(() => {
        throw error
      }),
    ).resolves.toEqual(projected('UNAUTHENTICATED', 'Authentication is required.'))
    expect(projectMcpToolError(error, { expose: ['UNAUTHENTICATED'] })).toEqual(
      projected('UNAUTHENTICATED', 'private-account-sentinel', true),
    )
  })

  it('recognizes a ConvexError from another Convex copy only by its exact marker', () => {
    const foreign = Object.assign(new Error('x'), {
      [Symbol.for('ConvexError')]: true,
      data: { code: 'MCP_ACCESS_DENIED', message: 'Revoked.' },
    })
    expect(projectMcpToolError(foreign, { expose: ['MCP_ACCESS_DENIED'] })).toEqual(
      projected('MCP_ACCESS_DENIED', 'Revoked.'),
    )
    const lookalike = Object.assign(new Error('x'), {
      name: 'ConvexError',
      data: { code: 'MCP_ACCESS_DENIED', message: 'Revoked.' },
    })
    expect(projectMcpToolError(lookalike)).toBeUndefined()
  })

  it('does not project unlisted codes, plain errors, or unsafe messages', () => {
    expect(
      projectMcpToolError(new ConvexError({ code: 'INTERNAL', message: 'db-sentinel' })),
    ).toBeUndefined()
    expect(projectMcpToolError(new ConvexError({ message: 'no code' }))).toBeUndefined()
    expect(projectMcpToolError(new Error('MCP_ACCESS_DENIED'))).toBeUndefined()
    expect(projectMcpToolError('MCP_ACCESS_DENIED')).toBeUndefined()
    expect(
      projectMcpToolError(new ConvexError({ code: 'MCP_ACCESS_DENIED', message: 'bad\u0000text' })),
    ).toMatchObject({
      content: [{ text: 'This connection is no longer allowed to access this data.' }],
    })
    expect(
      projectMcpToolError(
        new ConvexError({ code: 'MCP_ACCESS_DENIED', message: 'x'.repeat(1_001) }),
      ),
    ).toMatchObject({
      content: [{ text: 'This connection is no longer allowed to access this data.' }],
    })
    expect(() => projectMcpToolError(undefined, { expose: ['lower_case'] })).toThrow(
      'Invalid MCP exposed error code',
    )
  })

  it('never invokes getters on a hostile marker or data object', () => {
    const hostile = {}
    Object.defineProperty(hostile, Symbol.for('ConvexError'), {
      get() {
        throw new Error('marker-getter')
      },
    })
    expect(projectMcpToolError(hostile)).toBeUndefined()
    const data = {}
    Object.defineProperty(data, 'code', {
      enumerable: true,
      get() {
        throw new Error('data-getter')
      },
    })
    const withGetter = Object.assign(new Error('x'), { [Symbol.for('ConvexError')]: true, data })
    expect(projectMcpToolError(withGetter)).toBeUndefined()
  })

  it('reports the projected code to onToolError and returns the projection', async () => {
    const observed: unknown[] = []
    const result = await runMcpTool(
      () => {
        throw new ConvexError({ code: 'NOTE_LOCKED', message: 'Unlock the note first.' })
      },
      { name: 'notes.write', expose: ['NOTE_LOCKED'], onToolError: (m) => void observed.push(m) },
    )
    expect(result).toEqual(projected('NOTE_LOCKED', 'Unlock the note first.'))
    expect(observed).toEqual([{ kind: 'tool', name: 'notes.write', code: 'NOTE_LOCKED' }])
  })
})
