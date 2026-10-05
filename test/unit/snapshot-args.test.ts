import { expect, it } from 'vitest'
import { isProxy, reactive, ref } from 'vue'

import { snapshotArgs } from '../../packages/vue/src/internal/snapshot-args'

it('copies plain objects and arrays, and preserves opaque values', () => {
  class Opaque {
    name = 'Draft'
  }
  const buffer = new ArrayBuffer(8)
  const date = new Date(0)
  const instance = new Opaque()
  const valueRef = ref('Draft')
  const plain = Object.assign(Object.create(null), { name: 'Draft' }) as { name: string }
  const source = reactive({
    nested: { items: [{ name: 'Draft' }] },
    plain,
    bigint: 42n,
    nil: null,
    buffer,
    missing: undefined,
  })
  const input = { source, date, instance, valueRef }
  const snapshot = snapshotArgs(input)

  expect(snapshot).not.toBe(input)
  expect(snapshot.source).toEqual(source)
  expect(snapshot.source).not.toBe(source)
  expect(snapshot.source.nested).not.toBe(source.nested)
  expect(snapshot.source.nested.items).not.toBe(source.nested.items)
  expect(snapshot.source.nested.items[0]).not.toBe(source.nested.items[0])
  expect(snapshot.source.plain).not.toBe(plain)
  expect(snapshot.source.bigint).toBe(42n)
  expect(snapshot.source.nil).toBeNull()
  expect(snapshot.source.buffer).not.toBe(buffer)
  new Uint8Array(buffer)[0] = 1
  expect(new Uint8Array(snapshot.source.buffer)[0]).toBe(0)
  expect(Object.hasOwn(snapshot.source, 'missing')).toBe(true)
  expect(snapshot.source.missing).toBeUndefined()
  expect(snapshot.date).toBe(date)
  expect(snapshot.instance).toBe(instance)
  expect(snapshot.valueRef).toBe('Draft')
  expect(isProxy(snapshot.source)).toBe(false)
  expect(isProxy(snapshot.source.nested.items[0])).toBe(false)
  source.nested.items[0]!.name = 'Final'
  expect(snapshot.source.nested.items[0]!.name).toBe('Draft')
})

it('reads refs as their call-time values, at the top level, inside reactive objects and in arrays', () => {
  const boardId = ref('b1')
  const tag = ref('a')
  const fromReactive = snapshotArgs(reactive({ boardId, tags: [{ name: 'a' }] }))
  // Vue does not unwrap refs inside arrays of a reactive object; the snapshot does.
  const fromPlain = snapshotArgs({ boardId, tags: [tag] })

  expect(fromReactive).toEqual({ boardId: 'b1', tags: [{ name: 'a' }] })
  expect(fromPlain).toEqual({ boardId: 'b1', tags: ['a'] })
  boardId.value = 'b2'
  tag.value = 'b'
  expect(fromReactive.boardId).toBe('b1')
  expect(fromPlain).toEqual({ boardId: 'b1', tags: ['a'] })
})

it('copies cycles and shared references without losing graph identity', () => {
  const node: { self?: unknown; items?: unknown[] } = {}
  const items = [node]
  node.self = node
  node.items = items
  const buffer = new ArrayBuffer(1)
  const snapshot = snapshotArgs({ node, alias: node, items, buffers: [buffer, buffer] })
  expect(snapshot.node).not.toBe(node)
  expect(snapshot.node.self).toBe(snapshot.node)
  expect(snapshot.alias).toBe(snapshot.node)
  expect(snapshot.items).toBe(snapshot.node.items)
  expect(snapshot.items[0]).toBe(snapshot.node)
  expect(snapshot.buffers[0]).not.toBe(buffer)
  expect(snapshot.buffers[1]).toBe(snapshot.buffers[0])
})
