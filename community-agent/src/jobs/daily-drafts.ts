import { runDaily, type DailyRunInput } from '../agent/orchestrator.ts';

export function runDailyDrafts(input: DailyRunInput = {}) {
  return runDaily({ ...input, skipDiscover: input.skipDiscover ?? true });
}
