import { readFile, realpath } from "node:fs/promises";
import { pathToFileURL, URL } from "node:url";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";

// Metadata stays on the install exclusion itself, not in a second inventory.
export function checkDependencyPolicy(source, now = Date.now()) {
  const document = parseDocument(source);
  if (document.errors.length) return document.errors.map((error) => error.message);
  if (!isMap(document.contents)) return ["pnpm-workspace.yaml must contain a mapping."];
  const failures = [];
  for (const [key, expected] of Object.entries({
    minimumReleaseAge: 1440,
    minimumReleaseAgeStrict: true,
    minimumReleaseAgeIgnoreMissingTime: false,
  })) {
    if (document.get(key) !== expected) failures.push(`${key} must be ${expected}.`);
  }
  const exclusions = document.get("minimumReleaseAgeExclude", true);
  if (exclusions === undefined) return failures;
  if (!isSeq(exclusions)) return [...failures, "minimumReleaseAgeExclude must be a list."];
  const seen = new Set();
  for (const item of exclusions.items) {
    const name = isScalar(item) ? item.value : undefined;
    // Exact npm semver only; ranges, tags, globs and version groups bypass review.
    const identifier = "(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)";
    const version = `(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?`;
    if (typeof name !== "string" || !new RegExp(`^(?:@[a-z0-9._-]+/)?[a-z0-9._-]+@${version}$`).test(name)) {
      failures.push("Each quarantine exclusion must name one exact package@version.");
      continue;
    }
    if (seen.has(name)) failures.push(`${name}: duplicate quarantine exclusion.`);
    seen.add(name);
    let metadata;
    try { metadata = JSON.parse(item.comment ?? ""); } catch { /* Report missing or malformed metadata below. */ }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)
      || typeof metadata.reason !== "string" || !metadata.reason.trim()
      || typeof metadata.owner !== "string" || !metadata.owner.trim()) {
      failures.push(`${name}: inline JSON comment must contain a nonempty reason, owner, and expires.`);
      continue;
    }
    const expires = metadata.expires;
    const timestamp = typeof expires === "string" ? Date.parse(expires) : NaN;
    if (typeof expires !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(expires)
      || !Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== expires.replace("Z", ".000Z")) {
      failures.push(`${name}: expires must be a valid UTC timestamp (YYYY-MM-DDTHH:mm:ssZ).`);
    } else if (timestamp <= now) {
      failures.push(`${name}: quarantine exception expired at ${expires}; remove the exclusion and its comment.`);
    } else if (timestamp > now + 24 * 60 * 60 * 1000) {
      failures.push(`${name}: quarantine exception must expire within 24 hours.`);
    }
  }
  return failures;
}

export async function checkDependencyPolicyFile(path, now = Date.now()) {
  return checkDependencyPolicy(await readFile(path, "utf8"), now);
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  if (process.argv.length > 3) throw new Error("Usage: node scripts/check-dependency-policy.mjs [pnpm-workspace.yaml]");
  const path = process.argv[2] ?? new URL("../pnpm-workspace.yaml", import.meta.url);
  const failures = await checkDependencyPolicyFile(path);
  if (failures.length) {
    console.error(failures.map((failure) => `- ${failure}`).join("\n"));
    process.exitCode = 1;
  } else console.log("Dependency quarantine policy passed.");
}
