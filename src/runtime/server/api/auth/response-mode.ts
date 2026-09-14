/**
 * Some hosting ingress replaces Sec-Fetch-Mode with cors on navigations. Use
 * the surviving destination only to select the OAuth GET response format.
 * Original request headers must still govern the earlier Origin/CSRF checks.
 */
export function authProxyFetchMode(
  method: string,
  path: string,
  headers: Headers,
): 'cors' | 'same-origin' {
  if (headers.get('sec-fetch-mode') !== 'cors') return 'same-origin'
  if (method !== 'GET' || path !== '/oauth2/authorize') return 'cors'
  const destination = headers.get('sec-fetch-dest')
  if (destination !== 'document' && destination !== 'iframe') return 'cors'

  const acceptsHtml = (headers.get('accept') ?? '').split(',').some((entry) => {
    const [type, ...parameters] = entry.trim().toLowerCase().split(';')
    if (type !== 'text/html' && type !== 'application/xhtml+xml') return false
    const quality = parameters.find((parameter) => parameter.trim().startsWith('q='))
    if (!quality) return true
    const value = Number(quality.trim().slice(2))
    return value > 0 && value <= 1
  })
  return acceptsHtml ? 'same-origin' : 'cors'
}
