/**
 * CI gate for eval runs. Exits with code 1 if any named score's average
 * across `result.itemResults` falls below the configured minimum.
 *
 * Called conditionally from each runner when `EVAL_GATE=1` is set — so
 * `bun run eval:lastmile-orders` behaves normally locally (prints scores,
 * exits 0) but acts as a hard gate in CI.
 */

import type { ExperimentResult } from "@langfuse/client";

export interface GateThreshold {
  scoreName: string;
  min: number;
}

export function gate(
  result: ExperimentResult<unknown, unknown, Record<string, unknown>>,
  thresholds: GateThreshold[],
): void {
  const sums: Record<string, { total: number; count: number }> = {};
  for (const item of result.itemResults) {
    for (const evaluation of item.evaluations) {
      if (typeof evaluation.value !== "number") continue;
      const key = evaluation.name;
      sums[key] ??= { total: 0, count: 0 };
      sums[key].total += evaluation.value;
      sums[key].count += 1;
    }
  }

  console.log("\n──── Gate ────");
  let failed = false;
  for (const { scoreName, min } of thresholds) {
    const bucket = sums[scoreName];
    if (!bucket || bucket.count === 0) {
      console.error(`  ❌ ${scoreName}: NOT FOUND in result (required >= ${min})`);
      failed = true;
      continue;
    }
    const avg = bucket.total / bucket.count;
    const ok = avg >= min;
    console.log(
      `  ${ok ? "✓" : "❌"} ${scoreName}: ${avg.toFixed(3)} (min ${min}, n=${bucket.count})`,
    );
    if (!ok) failed = true;
  }

  if (failed) {
    console.error("\nEVAL_GATE FAILED — at least one threshold not met.");
    process.exit(1);
  }
  console.log("EVAL_GATE PASSED.\n");
}
