/** Reviewed protocol inputs retained even when the generated corpus changes. */
export const HOSTILE_ORIGINS = [
  'null',
  'https://app.example.test.evil.test',
  'https://app.example.test/path',
  'https://app.example.test%0d%0ax-injected:true',
  'https://user@app.example.test',
  'https://app.example.test:443',
  'https://APP.example.test',
] as const

export const HOSTILE_CALLBACK_PATHS = [
  '/callback/',
  '/callback/apple/extra',
  '/callback/%2Fescape',
  '/callback/%252Fescape',
  '/callback/%5Cescape',
  '/callback/%2e%2e',
  '/callback/%252e%252e',
  '/callback/%00apple',
  '/callback/%0d%0aheader',
  '/callback/%',
  '//callback/apple',
] as const

export const PROXY_CONTROL_HEADERS = [
  'forwarded',
  'host',
  'x-bcn-internal-session',
  'x-bcn-verified-client-ip',
  'x-better-auth-forwarded-host',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-original-host',
  'x-real-ip',
  'true-client-ip',
] as const

export const OAUTH_SINGLETON_FIELDS = [
  'client_id',
  'client_secret',
  'code',
  'code_challenge',
  'code_challenge_method',
  'code_verifier',
  'grant_type',
  'redirect_uri',
  'resource',
  'response_type',
  'scope',
  'state',
  'token',
] as const

export const AMBIGUOUS_UNKNOWN_FORM_FIELDS = [
  'resource%00',
  'resource%5B%5D',
  '%2572esource',
  'res%2500ource',
  'resource%20',
  'resource.',
  'client%255fid',
  '__proto__',
] as const

export const HOSTILE_REDIRECT_URIS = [
  'https://client.example.test/callback#fragment',
  'https://user@client.example.test/callback',
  'https://*.example.test/callback',
  'https://client.example.test/callback?next=*',
  'http://client.example.test/callback',
  'http://localhost/callback',
  'http://127.0.0.2:6274/callback',
  'javascript:alert(1)',
] as const

export const MALFORMED_BEARER_TOKENS = [
  '',
  'one',
  'one.two',
  'one.two.three.four',
  'one.two.three=',
  'one.tw+o.three',
  'one.A.three',
  'one.bm90LWpzb24.three',
  'Bearer one.two.three',
] as const
