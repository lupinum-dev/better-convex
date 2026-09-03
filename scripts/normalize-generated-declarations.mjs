import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outputRoot = resolve(process.argv[2] ?? "dist");
const generatedDeclarations = [
  "runtime/convex-auth/component/schema.d.ts",
  "runtime/convex-auth/test.d.ts",
];

for (const relativePath of generatedDeclarations) {
  const path = resolve(outputRoot, relativePath);
  const source = readFileSync(path, "utf8");
  const normalized = source
    // TypeScript can emit these adjacent inferred keys in either order after a
    // second Nuxt module build. Match the checked-in schema's canonical order.
    .replace(
      /^(\s*)sessionId: string \| null;\n\1clientId: string;$/gm,
      "$1clientId: string;\n$1sessionId: string | null;",
    )
    .replace(
      /"scopes" \| "sessionId" \| "clientId"/g,
      '"scopes" | "clientId" | "sessionId"',
    );

  if (normalized !== source) writeFileSync(path, normalized);
}
