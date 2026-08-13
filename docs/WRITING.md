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

## Structure public pages

- Put `title` and `description` in frontmatter.
- Do not add a body-level `#` heading.
- Organize pages by reader intent.
- Label code fences with a language and file path when applicable.
- Show one concept in each example.
- Put a security constraint before the affected action.
- Do not add generic summary or related-link sections.

Do not rewrite license text, code, API identifiers, command output, quotations,
changelog history, generated API reports, ASVS evidence, or audit records.
