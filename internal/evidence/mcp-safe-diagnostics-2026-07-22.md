# MCP safe diagnostics proof — 2026-07-22

## Outcome

The internal MCP tool boundary can optionally emit one frozen, allowlisted diagnostic for an unexpected
throw. It contains only a random local call ID, configured tool/operation/function metadata, static
classification/outcome, mechanically inspected cause type names, and a structured-data-presence flag.

It never receives tool input or output. It does not expose the raw cause, error message, stack, provider
reference, credential, HTTP state, identity, tenant, or application data.

## Safety properties executed

`test/unit/mcp-tool-errors.test.ts` proves:

- the emitted object is frozen and has the exact allowlist;
- the local call ID is random UUID-shaped data with no encoded request information;
- error message, stack, bearer, tenant data, and provider-reference sentinels are absent;
- diagnostic sink throws do not change the already-sanitized MCP result;
- hostile getters on `name`, `message`, `stack`, `data`, and `constructor` are never invoked;
- unknown failures remain the static public `Tool execution failed` result.

Commands:

```text
pnpm exec vitest run test/unit/mcp-tool-errors.test.ts --reporter=dot
pnpm --filter @better-convex/mcp typecheck
pnpm run check:boundaries
```

## Public API status

The mechanism stays package-internal until the exact neutral and Ginko migrations prove the final
registration shape. If admitted, it will be exported only with the opaque error boundary it observes;
there will be no raw inspector, generic logger, persistent store, or debug mode.
