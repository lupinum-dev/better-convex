const MAX_ID_LENGTH = 128
const MAX_NOTE_TITLE_LENGTH = 120
const MAX_SEARCH_QUERY_LENGTH = 200
const MAX_SEARCH_RESULTS = 50

export type NotesApplicationRole = 'editor' | 'owner'

/** Trusted application context. A transport must never copy this from tool input. */
export interface NotesApplicationActor {
  readonly role: NotesApplicationRole
  readonly subject: string
  readonly tenantId: string
}

export interface NotesApplicationSeed {
  readonly notes: readonly {
    readonly body: string
    readonly id: string
    readonly title: string
    readonly workspaceId: string
  }[]
  readonly workspaces: readonly {
    readonly id: string
    readonly name: string
    readonly tenantId: string
  }[]
}

export type NotesApplicationErrorCode =
  | 'ACCESS_DENIED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INPUT_INVALID'
  | 'NOTE_NOT_FOUND'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_STALE'

export class NotesApplicationError extends Error {
  readonly code: NotesApplicationErrorCode

  constructor(code: NotesApplicationErrorCode) {
    super(code)
    this.name = 'NotesApplicationError'
    this.code = code
  }
}

interface StoredWorkspace {
  deletedAt?: number
  id: string
  name: string
  revision: number
  tenantId: string
}

interface StoredNote {
  body: string
  deletedAt?: number
  id: string
  revision: number
  title: string
  workspaceId: string
}

export interface NoteResult {
  readonly body: string
  readonly id: string
  readonly revision: number
  readonly title: string
  readonly uri: string
  readonly workspaceId: string
}

export interface RenameNoteReceipt {
  readonly changed: boolean
  readonly noteId: string
  readonly previousTitle: string
  readonly requestKey: string
  readonly revision: number
  readonly title: string
}

export interface NoteResourceResult {
  readonly mimeType: 'application/json'
  readonly text: string
  readonly uri: string
}

export interface NotesReportResult {
  readonly generatedAt: number
  readonly noteCount: number
  readonly reportId: string
  readonly titles: readonly string[]
  readonly workspaceId: string
  readonly workspaceRevision: number
}

export interface DeletedWorkspaceResult {
  readonly deletedAt: number
  readonly deletedNoteCount: number
  readonly revision: number
  readonly workspaceId: string
}

/** Canonical application boundary used independently by each private topology probe. */
export interface NeutralNotesOperations {
  deleteWorkspace(
    actor: NotesApplicationActor,
    input: { readonly expectedRevision: number; readonly workspaceId: string },
  ): DeletedWorkspaceResult | Promise<DeletedWorkspaceResult>
  generateReport(
    actor: NotesApplicationActor,
    input: { readonly workspaceId: string },
  ): NotesReportResult | Promise<NotesReportResult>
  readNoteResource(
    actor: NotesApplicationActor,
    input: { readonly uri: string },
  ): NoteResourceResult | Promise<NoteResourceResult>
  renameNote(
    actor: NotesApplicationActor,
    input: { readonly noteId: string; readonly requestKey: string; readonly title: string },
  ): RenameNoteReceipt | Promise<RenameNoteReceipt>
  searchNotes(
    actor: NotesApplicationActor,
    input: { readonly limit?: number; readonly query: string; readonly workspaceId: string },
  ): readonly NoteResult[] | Promise<readonly NoteResult[]>
}

interface StoredRenameReceipt extends RenameNoteReceipt {
  readonly subject: string
  readonly tenantId: string
}

function fail(code: NotesApplicationErrorCode): never {
  throw new NotesApplicationError(code)
}

function boundedId(value: string): string {
  if (!value || value.length > MAX_ID_LENGTH || !/^[\w-]+$/.test(value)) {
    fail('INPUT_INVALID')
  }
  return value
}

function normalizeTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, ' ')
  if (!title || title.length > MAX_NOTE_TITLE_LENGTH) fail('INPUT_INVALID')
  return title
}

function noteUri(noteId: string): string {
  return `note://${noteId}`
}

/**
 * Reference application for the topology lab. It owns canonical state and policy;
 * it contains no MCP, HTTP, Convex, Nuxt, OAuth, or framework integration.
 */
export class NeutralNotesApplication implements NeutralNotesOperations {
  readonly #notes = new Map<string, StoredNote>()
  readonly #renameReceipts = new Map<string, StoredRenameReceipt>()
  readonly #workspaces = new Map<string, StoredWorkspace>()
  readonly #now: () => number

  constructor(seed: NotesApplicationSeed, now: () => number = Date.now) {
    this.#now = now

    for (const input of seed.workspaces) {
      const id = boundedId(input.id)
      if (this.#workspaces.has(id) || !input.tenantId || !input.name.trim()) {
        fail('INPUT_INVALID')
      }
      this.#workspaces.set(id, {
        id,
        name: input.name.trim(),
        revision: 1,
        tenantId: input.tenantId,
      })
    }

    for (const input of seed.notes) {
      const id = boundedId(input.id)
      const workspace = this.#workspaces.get(input.workspaceId)
      if (this.#notes.has(id) || !workspace) fail('INPUT_INVALID')
      this.#notes.set(id, {
        body: input.body,
        id,
        revision: 1,
        title: normalizeTitle(input.title),
        workspaceId: workspace.id,
      })
    }
  }

  searchNotes(
    actor: NotesApplicationActor,
    input: { readonly limit?: number; readonly query: string; readonly workspaceId: string },
  ): readonly NoteResult[] {
    const workspace = this.#requireWorkspace(actor, input.workspaceId)
    const query = input.query.trim().toLocaleLowerCase('en-US')
    if (query.length > MAX_SEARCH_QUERY_LENGTH) fail('INPUT_INVALID')
    const limit = input.limit ?? 20
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_RESULTS) fail('INPUT_INVALID')

    return [...this.#notes.values()]
      .filter(
        (note) =>
          note.workspaceId === workspace.id &&
          note.deletedAt === undefined &&
          (!query ||
            note.title.toLocaleLowerCase('en-US').includes(query) ||
            note.body.toLocaleLowerCase('en-US').includes(query)),
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, limit)
      .map((note) => this.#noteResult(note))
  }

  readNoteResource(
    actor: NotesApplicationActor,
    input: { readonly uri: string },
  ): NoteResourceResult {
    const match = /^note:\/\/([\w-]{1,128})$/.exec(input.uri)
    if (!match?.[1]) fail('INPUT_INVALID')
    const note = this.#requireNote(actor, match[1])
    const value = this.#noteResult(note)
    return {
      mimeType: 'application/json',
      text: JSON.stringify(value),
      uri: value.uri,
    }
  }

  renameNote(
    actor: NotesApplicationActor,
    input: { readonly noteId: string; readonly requestKey: string; readonly title: string },
  ): RenameNoteReceipt {
    const note = this.#requireNote(actor, input.noteId)
    const requestKey = boundedId(input.requestKey)
    const title = normalizeTitle(input.title)
    const receiptKey = `${actor.tenantId}:${requestKey}`
    const existing = this.#renameReceipts.get(receiptKey)
    if (existing) {
      if (
        existing.subject !== actor.subject ||
        existing.noteId !== note.id ||
        existing.title !== title
      ) {
        fail('IDEMPOTENCY_CONFLICT')
      }
      return this.#publicRenameReceipt(existing)
    }

    const previousTitle = note.title
    const changed = previousTitle !== title
    if (changed) {
      note.title = title
      note.revision += 1
    }
    const receipt: StoredRenameReceipt = {
      changed,
      noteId: note.id,
      previousTitle,
      requestKey,
      revision: note.revision,
      subject: actor.subject,
      tenantId: actor.tenantId,
      title,
    }
    this.#renameReceipts.set(receiptKey, receipt)
    return this.#publicRenameReceipt(receipt)
  }

  generateReport(
    actor: NotesApplicationActor,
    input: { readonly workspaceId: string },
  ): NotesReportResult {
    const workspace = this.#requireWorkspace(actor, input.workspaceId)
    const titles = [...this.#notes.values()]
      .filter((note) => note.workspaceId === workspace.id && note.deletedAt === undefined)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((note) => note.title)
    return {
      generatedAt: this.#now(),
      noteCount: titles.length,
      reportId: `${workspace.id}-r${workspace.revision}`,
      titles,
      workspaceId: workspace.id,
      workspaceRevision: workspace.revision,
    }
  }

  deleteWorkspace(
    actor: NotesApplicationActor,
    input: { readonly expectedRevision: number; readonly workspaceId: string },
  ): DeletedWorkspaceResult {
    if (actor.role !== 'owner') fail('ACCESS_DENIED')
    const workspace = this.#requireWorkspace(actor, input.workspaceId)
    if (workspace.revision !== input.expectedRevision) fail('WORKSPACE_STALE')

    const deletedAt = this.#now()
    let deletedNoteCount = 0
    for (const note of this.#notes.values()) {
      if (note.workspaceId === workspace.id && note.deletedAt === undefined) {
        note.deletedAt = deletedAt
        deletedNoteCount += 1
      }
    }
    workspace.deletedAt = deletedAt
    workspace.revision += 1
    return {
      deletedAt,
      deletedNoteCount,
      revision: workspace.revision,
      workspaceId: workspace.id,
    }
  }

  #noteResult(note: StoredNote): NoteResult {
    return {
      body: note.body,
      id: note.id,
      revision: note.revision,
      title: note.title,
      uri: noteUri(note.id),
      workspaceId: note.workspaceId,
    }
  }

  #publicRenameReceipt(receipt: StoredRenameReceipt): RenameNoteReceipt {
    return {
      changed: receipt.changed,
      noteId: receipt.noteId,
      previousTitle: receipt.previousTitle,
      requestKey: receipt.requestKey,
      revision: receipt.revision,
      title: receipt.title,
    }
  }

  #requireNote(actor: NotesApplicationActor, noteId: string): StoredNote {
    const note = this.#notes.get(boundedId(noteId))
    if (!note || note.deletedAt !== undefined) fail('NOTE_NOT_FOUND')
    this.#requireWorkspace(actor, note.workspaceId)
    return note
  }

  #requireWorkspace(actor: NotesApplicationActor, workspaceId: string): StoredWorkspace {
    const workspace = this.#workspaces.get(boundedId(workspaceId))
    if (!workspace || workspace.deletedAt !== undefined) fail('WORKSPACE_NOT_FOUND')
    if (!actor.subject || workspace.tenantId !== actor.tenantId) fail('ACCESS_DENIED')
    return workspace
  }
}
