import type { DataModelFromSchemaDefinition } from 'convex/server'

import type schema from './schema'

export type DataModel = DataModelFromSchemaDefinition<typeof schema>
