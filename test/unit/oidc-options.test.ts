import { describe, expect, it } from 'vitest'

import { resolveOidcConfig } from '../../src/runtime/convex-auth/oidc-options'

const PREFIX = '[better-convex] createBetterConvexAuth '
const SECRET = 's3cret-value'
const ISSUER_MESSAGE =
  'requires "oidc.issuer" to be an https URL without credentials, query or fragment (http only for localhost, 127.0.0.1 or [::1])'
const valid = {
  issuer: 'https://sso.example.com/realms/acme',
  clientId: 'app',
  clientSecret: SECRET,
}

describe('OIDC options', () => {
  for (const testCase of [
    {
      name: 'http issuer on a public host',
      value: { ...valid, issuer: 'http://sso.example.com/realms/acme' },
      message: ISSUER_MESSAGE,
    },
    {
      name: 'issuer with query',
      value: { ...valid, issuer: 'https://sso.example.com/realms/acme?x=1' },
      message: ISSUER_MESSAGE,
    },
    {
      name: 'issuer with fragment',
      value: { ...valid, issuer: 'https://sso.example.com/realms/acme#x' },
      message: ISSUER_MESSAGE,
    },
    {
      name: 'issuer with credentials',
      value: { ...valid, issuer: `https://app:${SECRET}@sso.example.com/realms/acme` },
      message: ISSUER_MESSAGE,
    },
    {
      name: 'empty client id',
      value: { ...valid, clientId: '' },
      message: 'requires "oidc.clientId" to be a non-empty string',
    },
    {
      name: 'empty client secret',
      value: { ...valid, clientSecret: '' },
      message: 'requires "oidc.clientSecret" to be a non-empty string',
    },
    {
      name: 'unknown key',
      value: { ...valid, discoveryUrl: 'https://sso.example.com/x' },
      message: 'does not support "oidc.discoveryUrl"',
    },
    {
      name: 'scopes key',
      value: { ...valid, scopes: ['groups'] },
      message: 'does not support "oidc.scopes"',
    },
  ]) {
    it(`rejects ${testCase.name}`, () => {
      const { value, message } = testCase
      let thrown: unknown
      try {
        resolveOidcConfig(value)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).toBe(`${PREFIX}${message}`)
      expect((thrown as Error).message).not.toContain(SECRET)
    })
  }

  for (const testCase of [
    { name: 'https issuer', issuer: 'https://sso.example.com/realms/acme', loopbackHttp: false },
    { name: 'http on 127.0.0.1', issuer: 'http://127.0.0.1:8080/realms/dev', loopbackHttp: true },
    { name: 'http on localhost', issuer: 'http://localhost:8080/realms/dev', loopbackHttp: true },
    { name: 'http on [::1]', issuer: 'http://[::1]:8080/realms/dev', loopbackHttp: true },
  ]) {
    it(`accepts ${testCase.name}`, () => {
      const { issuer, loopbackHttp } = testCase
      expect(resolveOidcConfig({ ...valid, issuer })).toEqual({
        issuer,
        clientId: 'app',
        clientSecret: SECRET,
        loopbackHttp,
      })
    })
  }
})
