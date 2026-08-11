import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Checked-in replay seeds. Add a minimized production failure here permanently. */
export const REVIEWED_AUTH_FUZZ_SEEDS = [
  439_041_101, 1_592_639_710, 2_654_435_769, 3_512_640_997,
] as const

const UINT32_MAX = 4_294_967_295
const DEFAULT_FAILURE_FILE = join(tmpdir(), 'better-convex-nuxt-auth-fuzz-last-failure.json')

export interface SeededRandom {
  integer(maxExclusive: number): number
  nextUint32(): number
  pick<T>(values: readonly T[]): T
}

function parseReplaySeed(value: string): number {
  if (!/^(?:0x[\da-f]+|\d+)$/iu.test(value)) {
    throw new TypeError('BCN_AUTH_FUZZ_SEED must be one unsigned 32-bit integer')
  }
  const parsed = Number(BigInt(value))
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > UINT32_MAX) {
    throw new TypeError('BCN_AUTH_FUZZ_SEED must be one unsigned 32-bit integer')
  }
  return parsed
}

export function selectedAuthFuzzSeeds(
  value: string | undefined = process.env.BCN_AUTH_FUZZ_SEED,
): readonly number[] {
  return value === undefined ? REVIEWED_AUTH_FUZZ_SEEDS : [parseReplaySeed(value)]
}

export function createSeededRandom(seed: number): SeededRandom {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > UINT32_MAX) {
    throw new TypeError('Auth fuzz seed must be one unsigned 32-bit integer')
  }
  // Xorshift32 has an all-zero fixed point, so mix that one input explicitly.
  let state = (seed || 1_831_565_813) >>> 0
  const nextUint32 = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
  return {
    integer(maxExclusive) {
      if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
        throw new TypeError('Seeded random bound must be a positive safe integer')
      }
      return nextUint32() % maxExclusive
    },
    nextUint32,
    pick<T>(values: readonly T[]): T {
      if (values.length === 0) throw new TypeError('Cannot pick from an empty corpus')
      return values[nextUint32() % values.length] as T
    },
  }
}

interface AuthFuzzFailureArtifact {
  caseIndex: number
  corpus: string
  replay: string
  seed: number
}

function saveFailure(artifact: AuthFuzzFailureArtifact): string {
  const path = process.env.BCN_AUTH_FUZZ_FAILURE_FILE || DEFAULT_FAILURE_FILE
  try {
    writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    return path
  } catch {
    return '(failure artifact could not be written)'
  }
}

/**
 * Execute a bounded deterministic corpus. Failures always contain a one-command
 * replay seed and are saved outside the repository by default.
 */
export async function runSeededAuthCorpus(
  corpus: string,
  casesPerSeed: number,
  runCase: (random: SeededRandom, caseIndex: number, seed: number) => unknown | Promise<unknown>,
): Promise<void> {
  if (!/^[a-z0-9-]+$/u.test(corpus)) throw new TypeError('Invalid auth fuzz corpus name')
  if (!Number.isSafeInteger(casesPerSeed) || casesPerSeed <= 0 || casesPerSeed > 1_000) {
    throw new TypeError('Auth fuzz case count must be between 1 and 1,000 per seed')
  }

  for (const seed of selectedAuthFuzzSeeds()) {
    const random = createSeededRandom(seed)
    for (let caseIndex = 0; caseIndex < casesPerSeed; caseIndex += 1) {
      try {
        await runCase(random, caseIndex, seed)
      } catch (cause) {
        const replay = `BCN_AUTH_FUZZ_SEED=${seed} pnpm test:auth-fuzz`
        const failureFile = saveFailure({ caseIndex, corpus, replay, seed })
        throw new Error(
          `Auth fuzz failure: corpus=${corpus} seed=${seed} case=${caseIndex}. Replay with \`${replay}\`. Seed artifact: ${failureFile}`,
          { cause },
        )
      }
    }
  }
}
