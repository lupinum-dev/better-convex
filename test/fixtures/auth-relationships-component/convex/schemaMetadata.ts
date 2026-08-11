import {
  fingerprintAuthSchemaModels,
  type AuthModelMetadata,
  type AuthSchemaMetadata,
} from '../../../../src/runtime/convex-auth/adapter/metadata'

function model(
  name: string,
  parent?: { model: string; onDelete: 'cascade' | 'restrict' | 'set null'; nullable: boolean },
): AuthModelMetadata {
  return {
    logicalName: name,
    physicalName: name,
    fields: {
      id: {
        logicalName: 'id',
        physicalName: 'id',
        kind: 'string',
        nullable: false,
        required: true,
        indexed: true,
        selectable: true,
        sortable: false,
        unique: true,
        updatable: false,
      },
      ...(parent
        ? {
            parentId: {
              logicalName: 'parentId',
              physicalName: 'parentId',
              kind: 'string' as const,
              nullable: parent.nullable,
              required: !parent.nullable,
              indexed: true,
              selectable: true,
              sortable: false,
              unique: false,
              updatable: true,
              reference: {
                model: parent.model,
                field: 'id',
                onDelete: parent.onDelete,
              },
            },
          }
        : {}),
    },
    indexes: [
      { descriptor: 'id', fields: ['id'], unique: true },
      ...(parent ? [{ descriptor: 'parentId', fields: ['parentId'] }] : []),
    ],
  }
}

const models = {
  parent: model('parent'),
  cascadeChild: model('cascadeChild', {
    model: 'parent',
    onDelete: 'cascade',
    nullable: false,
  }),
  restrictChild: model('restrictChild', {
    model: 'parent',
    onDelete: 'restrict',
    nullable: false,
  }),
  nullableChild: model('nullableChild', {
    model: 'parent',
    onDelete: 'set null',
    nullable: true,
  }),
  node: model('node', {
    model: 'node',
    onDelete: 'cascade',
    nullable: true,
  }),
} satisfies Record<string, AuthModelMetadata>

const schemaMetadata: AuthSchemaMetadata = {
  models,
  fingerprint: fingerprintAuthSchemaModels(models),
}

export default schemaMetadata
