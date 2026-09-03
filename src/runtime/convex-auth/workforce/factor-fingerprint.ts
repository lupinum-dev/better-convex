/** Bind an encrypted factor snapshot without copying factor material into metadata. */
export async function fingerprintWorkforceFactor(encryptedFactor: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptedFactor))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
