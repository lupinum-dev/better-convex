import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("generated declaration normalization", () => {
  it("stabilizes inferred OAuth token field order", () => {
    const fixture = mkdtempSync(join(tmpdir(), "bcn-declarations-"));
    const declarations = [
      "runtime/convex-auth/component/schema.d.ts",
      "runtime/convex-auth/test.d.ts",
    ];
    const unstable = `type Token = {\n  scopes: string[];\n  sessionId: string | null;\n  clientId: string;\n};\ntype Keys = "scopes" | "sessionId" | "clientId";\n`;

    try {
      for (const relativePath of declarations) {
        const path = join(fixture, relativePath);
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, unstable);
      }

      execFileSync(process.execPath, [
        "scripts/normalize-generated-declarations.mjs",
        fixture,
      ]);

      for (const relativePath of declarations) {
        expect(readFileSync(join(fixture, relativePath), "utf8")).toBe(
          `type Token = {\n  scopes: string[];\n  clientId: string;\n  sessionId: string | null;\n};\ntype Keys = "scopes" | "clientId" | "sessionId";\n`,
        );
      }
    } finally {
      rmSync(fixture, { force: true, recursive: true });
    }
  });
});
