import { z } from 'zod'

export const noteSchema = z
  .object({
    body: z.string(),
    id: z.string(),
    revision: z.number().int().positive(),
    title: z.string(),
    uri: z.string(),
    workspaceId: z.string(),
  })
  .strict()

export const notesSchema = z.array(noteSchema)

export const renameReceiptSchema = z
  .object({
    changed: z.boolean(),
    noteId: z.string(),
    previousTitle: z.string(),
    requestKey: z.string(),
    revision: z.number().int().positive(),
    title: z.string(),
  })
  .strict()

export const reportSchema = z
  .object({
    generatedAt: z.number().int(),
    noteCount: z.number().int().nonnegative(),
    reportId: z.string(),
    titles: z.array(z.string()),
    workspaceId: z.string(),
    workspaceRevision: z.number().int().positive(),
  })
  .strict()

export const deletedWorkspaceSchema = z
  .object({
    deletedAt: z.number().int(),
    deletedNoteCount: z.number().int().nonnegative(),
    revision: z.number().int().positive(),
    workspaceId: z.string(),
  })
  .strict()
