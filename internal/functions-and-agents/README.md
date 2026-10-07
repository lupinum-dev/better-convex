# Functions and agents: working notes

Notes from building `@lupinum/better-convex-functions` and
`@lupinum/better-convex-agents` (2026-10-06 to 2026-10-07): the walking
skeleton, its stress test, the port into the packages, and the verification
rounds. Read the file for your task instead of repeating the research.

| File                                       | Read it when you                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [review-checklist.md](review-checklist.md) | change or review row rules, operations, approvals, tools or the MCP door                             |
| [measurements.md](measurements.md)         | talk about cost or speed, or change something on the hot path                                        |
| [usage.py](usage.py)                       | want per-call numbers from a deployment's logs                                                       |
| [platform-facts.md](platform-facts.md)     | depend on how Convex, convex-test, MCP hosts, Better Auth or Vercel behave                           |
| [verdicts.md](verdicts.md)                 | consider an alternative design, an optimisation, or replacing the agent runtime                      |
| [plan.md](plan.md)                         | need the phases, the definition of done, the security invariants (section 6) or the item list V1–V16 |

Where the rest lives:

- The walking skeleton, its slices and the runtime spike: the
  `spike/walking-skeleton` branch of this repository (worktree
  `bc-skeleton/labs/skeleton`). Its `STRESS.md` holds the stress-test
  hypotheses and findings R1–R27 with the test for each; its `PLAN.md` holds
  the design history, the API freeze table and the runtime spike.
- Live evidence (screenshots, logs, harness output) is in the skeleton's
  `evidence/` folder, which git ignores. Folders `10-packages` and
  `11-vercel` are the runs on the packed packages.
- Decisions with lasting effect: `DECISIONS.md` D31–D36.
- What app developers should know: the docs under
  `docs/content/docs/3.build/8.functions` and `3.build/7.agents`.
