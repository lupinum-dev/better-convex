import { describe, expect, it } from 'vitest'
import { reactive, ref } from 'vue'

import { snapshotUploadContext } from '../../packages/vue/src/internal/upload-context'

describe('snapshotUploadContext', () => {
  it('copies plain objects and arrays, including reactive proxies', () => {
    const state = reactive({
      assetId: 'asset_a',
      path: ['root'],
      nested: { folder: 'a' },
    })
    const snapshot = snapshotUploadContext(state)

    state.assetId = 'asset_b'
    state.path.push('child')
    state.nested.folder = 'b'
    expect(snapshot).toEqual({
      assetId: 'asset_a',
      path: ['root'],
      nested: { folder: 'a' },
    })
  })

  it('keeps primitives, class instances, and refs as they are', () => {
    const file = new File(['x'], 'x.txt')
    const selected = ref('asset_a')
    const date = new Date(0)
    expect(snapshotUploadContext('asset_a')).toBe('asset_a')
    expect(snapshotUploadContext(undefined)).toBeUndefined()
    const snapshot = snapshotUploadContext({ file, selected, date })
    expect(snapshot.file).toBe(file)
    expect(snapshot.selected).toBe(selected)
    expect(snapshot.date).toBe(date)
  })

  it('copies cyclic plain data without recursing forever', () => {
    const node: { name: string; self?: unknown } = { name: 'a' }
    node.self = node
    const snapshot = snapshotUploadContext(node)
    expect(snapshot).not.toBe(node)
    expect(snapshot.self).toBe(snapshot)
  })
})
