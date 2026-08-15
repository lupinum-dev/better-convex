export function requirePreparedReleaseNotes(changelog, tag) {
  const heading = `## ${tag}`
  const lines = changelog.split(/\r?\n/u)
  const matches = lines.flatMap((line, index) => (line === heading ? [index] : []))

  if (matches.length !== 1) {
    throw new Error(`CHANGELOG.md must contain exactly one ${heading} release section.`)
  }

  const start = matches[0] + 1
  const nextHeading = lines.findIndex((line, index) => index >= start && line.startsWith('## '))
  const notes = lines
    .slice(start, nextHeading === -1 ? undefined : nextHeading)
    .join('\n')
    .trim()
  if (!/^- /mu.test(notes)) {
    throw new Error(`CHANGELOG.md ${heading} release section must contain non-empty notes.`)
  }

  return notes
}
