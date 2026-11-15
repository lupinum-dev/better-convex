import type { GenericId } from 'convex/values'

export type TableNames = 'tasks' | 'files'

export type Id<TableName extends TableNames | 'system'> = GenericId<TableName>
