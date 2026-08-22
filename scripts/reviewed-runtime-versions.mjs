import { readFileSync } from 'node:fs'

import { packageCertificationDescriptors } from './package-certification-manifest.mjs'
import { supportedDependencyTuple } from './supported-dependency-tuple.mjs'

const exactVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u

export function derivePackagePhysicalVersions(packageId, manifest) {
  const sources =
    packageId === 'vue'
      ? Object.fromEntries(
          ['convex', 'vue'].map((name) => [name, manifest.devDependencies?.[name]]),
        )
      : packageId === 'mcp'
        ? {
            ...manifest.dependencies,
            ...Object.fromEntries(
              ['@modelcontextprotocol/ext-apps', '@modelcontextprotocol/sdk', 'vue'].map((name) => [
                name,
                manifest.devDependencies?.[name],
              ]),
            ),
          }
        : manifest.dependencies
  if (
    !sources ||
    Object.entries(sources).some(
      ([, version]) => typeof version !== 'string' || !exactVersion.test(version),
    )
  ) {
    throw new Error(`Package ${packageId} physical runtime versions must be exact manifest pins.`)
  }
  return Object.freeze({ ...sources })
}

const siblingRuntimeVersions = Object.fromEntries(
  packageCertificationDescriptors
    .filter((descriptor) => descriptor.id !== 'nuxt')
    .flatMap((descriptor) => {
      const manifest = JSON.parse(
        readFileSync(
          new URL(`../${descriptor.packageDirectory}/package.json`, import.meta.url),
          'utf8',
        ),
      )
      return Object.entries(derivePackagePhysicalVersions(descriptor.id, manifest))
    }),
)

export const reviewedAdvisoryTuple = Object.freeze({
  ...supportedDependencyTuple,
  ...siblingRuntimeVersions,
})
