# Writing documentation

Better Convex uses Lupinum Controlled English. This profile is based on
ASD-STE100 Issue 9. It does not claim formal ASD-STE100 compliance.

## Write for the user

- Start with the result or action.
- Use short, active sentences.
- Put one instruction in each sentence.
- Use the imperative form for procedures.
- Use one term for one concept.
- Define a technical term before you use it.
- Put a warning before the affected action.
- Use sentence-case headings.
- Use American English spelling.

Do not use filler such as `simply`, `just`, `obviously`, `easy`, `seamless`, or
`powerful`.

## Use the approved terms

- **Application**: the user's Nuxt or Vue application.
- **Package**: one published Better Convex package.
- **Module**: the `@lupinum/better-convex-nuxt` Nuxt module.
- **Convex function**: a query, mutation, action, or HTTP action owned by the
  application backend.
- **Session**: the persisted Better Auth session.
- **Convex session token**: the short-lived token used for Convex identity.
- **OAuth access token**: the separate delegated bearer token for one resource.
- **Release artifact**: an immutable package tarball retained by the workflow.

Do not use session cookie, Convex session token, and OAuth access token as
interchangeable terms.

## Use plain words

Write for a Nuxt developer who has never seen this library. Replace internal
project words with the plain word in the right column. Keep the internal word
only in a code identifier, command output, or a generated report.

| Do not write                              | Write                                    |
| ----------------------------------------- | ---------------------------------------- |
| authority, deployment authority           | deployment, the Convex deployment in use |
| admission, admitted session               | session check, valid session             |
| ceremony                                  | steps, flow                              |
| certified, certification                  | tested, checked                          |
| closed traffic gate                       | before the app receives public traffic   |
| evidence                                  | test, test result                        |
| file-bound                                | reads `.env.local`                       |
| fence, fencing                            | stop, discard                            |
| hard cut                                  | breaking change                          |
| invariant                                 | rule                                     |
| owner, owns (for code)                    | creates, controls, is responsible for    |
| reviewed profile                          | default settings                         |
| settle, settlement                        | finish, finish loading                   |
| source candidate, release candidate prose | this version                             |
| surface                                   | API, functions, options                  |
| topology                                  | setup                                    |
| utilize, leverage                         | use                                      |

Also avoid these patterns:

- Do not explain why a design is correct. Tell the reader what to do and what
  happens.
- Do not repeat a concept on every page. Explain it once in Concepts and link
  to it.
- Do not describe internal review, release, or test process on user pages.

## Structure public pages

Public root and package READMEs use the shared Lupinum structure. Start with a
128 px product icon, centered product name, one-sentence value statement, npm,
CI, and MIT badges, and a release warning when the package is not stable. Then
explain why and when to use the package before installation and the smallest
useful example. End with documentation, contribution, support, security, and
license information.

- Put `title` and `description` in frontmatter.
- Do not add a body-level `#` heading.
- Organize pages by reader intent.
- Label code fences with a language and file path when applicable.
- Show one concept in each example.
- Put a security constraint before the affected action.
- Do not add generic summary or related-link sections.

Do not rewrite license text, code, API identifiers, command output, quotations,
changelog history, generated API reports, ASVS evidence, or audit records.
