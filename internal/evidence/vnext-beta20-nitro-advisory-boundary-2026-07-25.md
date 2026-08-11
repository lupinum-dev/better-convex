# vNext beta.20 Nitro advisory boundary

Date: 2026-07-25

## Outcome

The immutable Vue/Nuxt `0.8.0-beta.20` and MCP `0.1.0-beta.8` artifacts are
retired as a coordinated candidate set and must never be rebuilt or published.

MCP beta.8 and the Vue beta.20 package lane passed. The complete Vue/Nuxt set
also passed source checks, 1,895 tests, browser and DAST suites, authentication,
OAuth, mutation, concurrency, fuzz, sentinel, MFA, MCP, build, SBOM, and
exact-byte checks. Its isolated npm Nuxt consumer then failed closed because
Nuxt `4.4.8` resolves Nitro `2.13.4`, whose Azure deployment preset retains
`archiver@7.0.1` and `brace-expansion@2.1.2`.

## Corrected diagnosis

The beta.19 evidence correctly found and fixed package-owned `@nuxt/kit`
version drift. It incorrectly treated that drift as the complete source of the
advisory. An isolated beta.20 trace proved two independent facts:

1. `@nuxt/kit` must remain exactly equal to the supported Nuxt peer so BCN
   cannot silently certify one runtime and install another.
2. Even with that pin, Nuxt `4.4.8` installs Nitro `2.13.4`, which declares
   `archiver@^7.0.1`. That range cannot adopt `archiver@8`, the first major
   whose readdir/glob graph can resolve the patched `brace-expansion@5.0.8`.

The root and maintained pnpm fixtures hide this second path with a workspace
override. A generic npm consumer cannot inherit a publisher's override.
Teaching the clean consumer to add one would therefore certify a condition BCN
cannot deliver and was rejected.

## Executable reachability

Exact installed source was inspected:

- Nitro imports `archiver` only from
  `nitropack/dist/presets/azure/utils.mjs`.
- The Azure deployment builder calls
  `archive.glob("**/*", { cwd: dir, nodir: true, dot: true, follow: true })`.
- The pattern is a source constant. The directory is Nitro's generated output
  directory.
- The generated Nitro server runtime does not import `archiver`,
  `readdir-glob`, `minimatch`, or `brace-expansion`.
- Better Convex exposes no glob-pattern API and no request, cookie, token,
  function argument, or application value can influence this pattern.

The reviewed advisory states that exploitation requires an
attacker-influenced brace/glob pattern and explicitly recommends avoiding
untrusted patterns when an immediate upgrade is unavailable:

- <https://github.com/advisories/GHSA-mh99-v99m-4gvg>

The exception is therefore exact and temporary, not a claim that the affected
package is patched:

- package/version: `brace-expansion@2.1.2`;
- owner: Better Convex maintainers;
- created: 2026-07-25;
- expires: 2026-08-24;
- boundary: Nitro `2.13.4` Azure deployment archive construction with the
  constant `**/*` pattern;
- replacement condition: Nitro adopts a compatible patched archiver/glob
  dependency graph.

Production request handling, SSR, authentication, OAuth, MCP, and generated
server runtime do not reach the affected call.

## Immutable beta.20 artifacts

All three artifacts bind source commit
`55ba03950f3674b558d8524a1f00ae2ac1ce1555`.

| Package              | Version         | SHA-256                                                            |
| -------------------- | --------------- | ------------------------------------------------------------------ |
| `better-convex-vue`  | `0.8.0-beta.20` | `04fcda4a7e174cf3e227b973771352a95993d4bd7de1be5800e4726cfeeabbba` |
| `better-convex-nuxt` | `0.8.0-beta.20` | `d5dd8a79425ba086538ccfa8684debd14e77373ac4034eb09df074328a22fa66` |
| `@better-convex/mcp` | `0.1.0-beta.8`  | `61912e3320121eb80f3be2b18f43601780a4e4f2c1b2326e76db7ebb70349f40` |

## Successor rule

- Vue and Nuxt advance together to `0.8.0-beta.21`.
- MCP advances to `0.1.0-beta.9` so every public candidate binds one clean
  source commit.
- The exact `@nuxt/kit@4.4.8` pin remains part of the supported tuple.
- The advisory gate must accept only the exact recorded version. Another
  affected version, another package, or an expired exception fails closed.
- Official immutable candidates may be created only after the corrected tree
  is committed and clean.
