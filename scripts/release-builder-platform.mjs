export const releaseBuilderPlatform = 'linux'

/** Require the platform that owns publishable package bytes and candidate locks. */
export function assertReleaseBuilderPlatform(platform = process.platform) {
  if (platform !== releaseBuilderPlatform) {
    throw new Error(
      'Release artifacts, candidate locks, and release smoke must be created on the reviewed Linux builder.',
    )
  }
  return platform
}
