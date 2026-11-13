/** Tables come only from the successful built-in verifier. Each row describes its actual input domain. */
export function verifiedBranchTables(content: string): string[] {
  const value = JSON.parse(content);
  if (value?.ok !== true) return [];
  const families: unknown[] = Array.isArray(value.families) ? value.families : [value];
  return families.flatMap(family => {
    if (!family || typeof family !== "object" || !("branch_table" in family) || typeof family.branch_table !== "string") return [];
    return [family.branch_table];
  });
}

/** Older/smaller models may still draw a table after being asked to supply just the derivation. */
export function replaceBranchTables(proof: string, tables: string[]): string {
  const lines = proof.split("\n"), kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const isTable = lines[i].includes("|") && /^\s*\|?\s*:?-{2,}/u.test(lines[i+1] ?? "");
    if (isTable && /左支|右支|单调|递增|递减|根数|解数|交点|参数|解的个数|解个数|解数目|不同实根|解的数量/u.test(lines[i])) {
      i++;
      while (i+1 < lines.length && lines[i+1].includes("|")) i++;
    } else kept.push(lines[i]);
  }
  return [kept.join("\n").trim(), ...tables].filter(Boolean).join("\n\n");
}
