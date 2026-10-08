import { fns } from './functions'

// Erases what the app holds about a person, in batches (see `erasure` in ./functions.ts).
// `onDelete` in ./auth.ts starts it when the person deletes their account.
export const { eraseStep } = fns.erasure
