import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

import schemaMetadata from './schemaMetadata'

const parent = defineTable({ id: v.string() }).index('id', ['id'])
const requiredChild = () =>
  defineTable({ id: v.string(), parentId: v.string() })
    .index('id', ['id'])
    .index('parentId', ['parentId'])
const nullableChild = () =>
  defineTable({ id: v.string(), parentId: v.union(v.null(), v.string()) })
    .index('id', ['id'])
    .index('parentId', ['parentId'])

const schema = defineSchema({
  parent,
  cascadeChild: requiredChild(),
  restrictChild: requiredChild(),
  nullableChild: nullableChild(),
  node: nullableChild(),
})

Object.defineProperty(schema, '__betterConvexNuxtAuthSchemaFingerprint', {
  value: schemaMetadata.fingerprint,
})

export default schema
