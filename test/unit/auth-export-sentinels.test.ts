import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  assertComponentExportCoverage,
  assertComponentExportRows,
  assertOAuthBrowserStorageCoverage,
  parseExportArchiveTotals,
  runFailClosedCleanup,
  validateExportArchiveEntries,
} from '../../scripts/run-auth-export-sentinels.mjs'

const oauthRunner = fileURLToPath(
  new URL('../../scripts/run-oauth-code-concurrency.mjs', import.meta.url),
)

const componentExport = [
  '_components/betterAuth/account/documents.jsonl',
  '_components/betterAuth/jwks/documents.jsonl',
  '_components/betterAuth/oauthAccessToken/documents.jsonl',
  '_components/betterAuth/oauthClient/documents.jsonl',
  '_components/betterAuth/verification/documents.jsonl',
]

const componentRows = componentExport.flatMap((file) => {
  const table = file.split('/').at(-2)
  const count =
    table === 'account' ? 2 : table === 'oauthClient' ? 3 : table === 'oauthAccessToken' ? 0 : 1
  return [{ path: file, value: Buffer.from('{"id":"row"}\n'.repeat(count)) }]
})

describe('real auth export sentinel gate', () => {
  it('accepts one bounded component snapshot and requires every credential-bearing table', () => {
    expect(validateExportArchiveEntries(componentExport)).toEqual(componentExport)
    expect(
      parseExportArchiveTotals(
        '5 files, 13889 bytes uncompressed, 2048 bytes compressed: 85.3%',
        5,
      ),
    ).toEqual({ bytes: 13_889, entries: 5 })
    expect(assertComponentExportCoverage(componentExport)).toEqual([
      'account',
      'jwks',
      'oauthAccessToken',
      'oauthClient',
      'verification',
    ])
    expect(assertComponentExportRows(componentRows)).toEqual({
      account: 2,
      jwks: 1,
      oauthAccessToken: 0,
      oauthClient: 3,
      verification: 1,
    })

    expect(() => assertComponentExportCoverage(componentExport.slice(1))).toThrow(
      'AUTH_EXPORT_COMPONENT_TABLE_MISSING:account',
    )
    expect(() => assertComponentExportRows(componentRows.slice(1))).toThrow(
      'AUTH_EXPORT_COMPONENT_ROW_MISSING:account',
    )
  })

  it('rejects archive totals that cannot prove the entry count and extraction bound', () => {
    expect(() => parseExportArchiveTotals('unparseable', 5)).toThrow(
      'AUTH_EXPORT_ARCHIVE_TOTALS_INVALID',
    )
    expect(() =>
      parseExportArchiveTotals('4 files, 10 bytes uncompressed, 5 bytes compressed', 5),
    ).toThrow('AUTH_EXPORT_ARCHIVE_ENTRY_COUNT_MISMATCH')
    expect(() =>
      parseExportArchiveTotals('5 files, 134217729 bytes uncompressed, 5 bytes compressed', 5),
    ).toThrow('AUTH_EXPORT_TOTAL_SIZE_BOUND_EXCEEDED')
  })

  it.each([
    ['/absolute/documents.jsonl'],
    ['../escape/documents.jsonl'],
    ['safe/../../escape/documents.jsonl'],
    ['safe\\escape\\documents.jsonl'],
    ['duplicate/documents.jsonl', 'duplicate/documents.jsonl'],
  ])('rejects an unsafe or ambiguous ZIP path set', (...entries) => {
    expect(() => validateExportArchiveEntries(entries)).toThrow(/^AUTH_EXPORT_/u)
  })

  it('pins the live OAuth browser evidence to every supported persistence surface', () => {
    const source = readFileSync(oauthRunner, 'utf8')
    expect(assertOAuthBrowserStorageCoverage(source)).toEqual({
      cacheStorage: 'must-be-empty',
      cookies: 'scanned',
      indexedDb: 'must-be-empty',
      localStorage: 'scanned',
      sessionStorage: 'scanned',
    })

    for (const marker of [
      'Object.entries(localStorage)',
      'Object.entries(sessionStorage)',
      'applicationStorage.cacheNames.length === 0',
      'applicationStorage.indexedDbNames.length === 0',
      'state.cookies.every',
    ]) {
      expect(() => assertOAuthBrowserStorageCoverage(source.replace(marker, 'removed'))).toThrow(
        'AUTH_BROWSER_STORAGE_SURFACE_MISSING',
      )
    }
  })

  it('attempts every finalizer and reports one credential-free stable cleanup failure', async () => {
    const calls: string[] = []
    await expect(
      runFailClosedCleanup([
        async () => {
          calls.push('context')
          throw new Error('raw-context-cleanup-detail')
        },
        async () => {
          calls.push('browser')
        },
        async () => {
          calls.push('fixture')
          throw new Error('raw-fixture-cleanup-detail')
        },
        async () => {
          calls.push('scratch')
        },
      ]),
    ).rejects.toThrow(/^AUTH_EXPORT_CLEANUP_FAILED$/u)
    expect(calls).toEqual(['context', 'browser', 'fixture', 'scratch'])
  })
})
