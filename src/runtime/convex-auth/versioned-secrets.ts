/** Parse the versioned encryption keys used by auth construction and the adapter. */
export function parseVersionedSecrets(
  raw: string | undefined,
): Array<{ value: string; version: number }> {
  if (!raw) return []
  const versions = new Set<number>()
  return raw.split(',').map((entry) => {
    const separator = entry.indexOf(':')
    const versionText = separator < 0 ? '' : entry.slice(0, separator).trim()
    const value = separator < 0 ? '' : entry.slice(separator + 1).trim()
    const version = Number(versionText)
    if (
      !/^(?:0|[1-9]\d*)$/u.test(versionText) ||
      !Number.isSafeInteger(version) ||
      versions.has(version) ||
      value.length < 32
    ) {
      throw new Error('AUTH_VERSIONED_SECRETS_INVALID')
    }
    versions.add(version)
    return { value, version }
  })
}
