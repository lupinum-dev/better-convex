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
  expect(snapshot.valueRef).toBe(valueRef)
  expect(isProxy(snapshot.source)).toBe(false)
  expect(isProxy(snapshot.source.nested.items[0])).toBe(false)
  source.nested.items[0]!.name = 'Final'
  expect(snapshot.source.nested.items[0]!.name).toBe('Draft')
})

it('reads refs inside reactive objects as their values, like the Convex client does', () => {
  const boardId = ref('b1')
  const snapshot = snapshotArgs(reactive({ boardId, tags: [{ name: 'a' }] }))

  expect(snapshot).toEqual({ boardId: 'b1', tags: [{ name: 'a' }] })
  boardId.value = 'b2'
  expect(snapshot.boardId).toBe('b1')
})
