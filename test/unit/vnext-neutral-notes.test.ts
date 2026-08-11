import { describe, expect, it } from 'vitest'

import {
  NeutralNotesApplication,
  type NotesApplicationError,
  type NotesApplicationActor,
} from '../../internal/labs/mcp-topology/neutral/notes-application'

const alice: NotesApplicationActor = {
  role: 'editor',
  subject: 'user-alice',
  tenantId: 'tenant-a',
}
const owner: NotesApplicationActor = {
  role: 'owner',
  subject: 'user-owner',
  tenantId: 'tenant-a',
}
const mallory: NotesApplicationActor = {
  role: 'owner',
  subject: 'user-mallory',
  tenantId: 'tenant-b',
}

function createApplication() {
  return new NeutralNotesApplication(
    {
      notes: [
        {
          body: 'Topology findings and decisions',
          id: 'note-alpha',
          title: 'Architecture review',
          workspaceId: 'workspace-a',
        },
        {
          body: 'Release evidence checklist',
          id: 'note-beta',
          title: 'Certification plan',
          workspaceId: 'workspace-a',
        },
        {
          body: 'Private tenant material',
          id: 'note-secret',
          title: 'Tenant B only',
          workspaceId: 'workspace-b',
        },
      ],
      workspaces: [
        { id: 'workspace-a', name: 'Alpha workspace', tenantId: 'tenant-a' },
        { id: 'workspace-b', name: 'Beta workspace', tenantId: 'tenant-b' },
      ],
    },
    () => 1_800_000_000_000,
  )
}

function expectCode(action: () => unknown, code: NotesApplicationError['code']) {
  expect(action).toThrowError(expect.objectContaining({ code }))
}

describe('neutral notes application', () => {
  it('searches and reads exact note resources only inside the current tenant', () => {
    const application = createApplication()

    expect(
      application.searchNotes(alice, {
        query: 'architecture',
        workspaceId: 'workspace-a',
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'note-alpha',
        title: 'Architecture review',
        uri: 'note://note-alpha',
      }),
    ])
    expect(
      JSON.parse(application.readNoteResource(alice, { uri: 'note://note-beta' }).text),
    ).toMatchObject({ id: 'note-beta', workspaceId: 'workspace-a' })

    expectCode(
      () =>
        application.searchNotes(mallory, {
          query: '',
          workspaceId: 'workspace-a',
        }),
      'ACCESS_DENIED',
    )
    expectCode(
      () => application.readNoteResource(mallory, { uri: 'note://note-alpha' }),
      'ACCESS_DENIED',
    )
    expectCode(
      () => application.readNoteResource(alice, { uri: 'note://note-alpha?leak=true' }),
      'INPUT_INVALID',
    )
  })

  it('renames once for an idempotency key and rejects key reuse with different intent', () => {
    const application = createApplication()
    const input = {
      noteId: 'note-alpha',
      requestKey: 'rename-001',
      title: '  Accepted   architecture  ',
    }

    const first = application.renameNote(alice, input)
    const retry = application.renameNote(alice, input)

    expect(first).toEqual({
      changed: true,
      noteId: 'note-alpha',
      previousTitle: 'Architecture review',
      requestKey: 'rename-001',
      revision: 2,
      title: 'Accepted architecture',
    })
    expect(retry).toEqual(first)
    expect(application.readNoteResource(alice, { uri: 'note://note-alpha' }).text).toContain(
      'Accepted architecture',
    )
    expectCode(
      () => application.renameNote(alice, { ...input, title: 'Different intent' }),
      'IDEMPOTENCY_CONFLICT',
    )
    expectCode(
      () => application.renameNote(mallory, { ...input, requestKey: 'rename-002' }),
      'ACCESS_DENIED',
    )
  })

  it('generates a direct report without creating a second job or artifact state', () => {
    const application = createApplication()

    expect(application.generateReport(alice, { workspaceId: 'workspace-a' })).toEqual({
      generatedAt: 1_800_000_000_000,
      noteCount: 2,
      reportId: 'workspace-a-r1',
      titles: ['Architecture review', 'Certification plan'],
      workspaceId: 'workspace-a',
      workspaceRevision: 1,
    })
    expectCode(
      () => application.generateReport(mallory, { workspaceId: 'workspace-a' }),
      'ACCESS_DENIED',
    )
  })

  it('keeps workspace deletion application-owned, revision-bound, and tenant-bound', () => {
    const application = createApplication()

    expectCode(
      () =>
        application.deleteWorkspace(alice, {
          expectedRevision: 1,
          workspaceId: 'workspace-a',
        }),
      'ACCESS_DENIED',
    )
    expectCode(
      () =>
        application.deleteWorkspace(owner, {
          expectedRevision: 2,
          workspaceId: 'workspace-a',
        }),
      'WORKSPACE_STALE',
    )
    expectCode(
      () =>
        application.deleteWorkspace(mallory, {
          expectedRevision: 1,
          workspaceId: 'workspace-a',
        }),
      'ACCESS_DENIED',
    )

    expect(
      application.deleteWorkspace(owner, {
        expectedRevision: 1,
        workspaceId: 'workspace-a',
      }),
    ).toEqual({
      deletedAt: 1_800_000_000_000,
      deletedNoteCount: 2,
      revision: 2,
      workspaceId: 'workspace-a',
    })
    expectCode(
      () =>
        application.searchNotes(owner, {
          query: '',
          workspaceId: 'workspace-a',
        }),
      'WORKSPACE_NOT_FOUND',
    )
    expectCode(
      () => application.readNoteResource(owner, { uri: 'note://note-alpha' }),
      'NOTE_NOT_FOUND',
    )
  })
})
