import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outputDir = fileURLToPath(new URL('../src/runtime/devtools/ui/dist/', import.meta.url))

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  })
}

for (const path of filesBelow(outputDir)) {
  if (!path.endsWith('.html') && !path.endsWith('.json')) continue

  const source = readFileSync(path, 'utf8')
  const normalized = source
    .replace(/"timestamp":\d+/g, '"timestamp":0')
    .replace(
      /("prerenderedAt":\d+,"serverRendered":(?:true|false|\d+)\},)\d+/g,
      (_, prefix) => `${prefix}0`,
    )

  if (normalized !== source) writeFileSync(path, normalized)
}
