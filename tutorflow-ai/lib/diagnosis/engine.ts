import type { DiagnosisGraph, DiagnosisState, ProbeObservation } from "./types";
import type { ProbeResult } from "@/lib/db/types";

export function createDiagnosisState(graph: DiagnosisGraph): DiagnosisState {
  return Object.fromEntries(graph.conceptIds.map((id) => [id, "unknown"]));
}

export function applyProbeResult(
  graph: DiagnosisGraph,
  state: DiagnosisState,
  conceptId: string,
  result: ProbeResult,
): DiagnosisState {
  if (!(conceptId in graph.depthMap)) throw new Error("unknown_concept");
  const next: DiagnosisState = { ...createDiagnosisState(graph), ...state, [conceptId]: result };
  if (result === "skipped") return next;
  const neighbors = result === "solved" ? graph.prerequisites : graph.dependents;
  const queue = [...(neighbors[conceptId] ?? [])];
  while (queue.length) {
    const id = queue.shift()!;
    if (next[id] === result) continue;
    next[id] = result;
    queue.push(...(neighbors[id] ?? []));
  }
  return next;
}

export const propagateResult = applyProbeResult;

export function replayProbes(graph: DiagnosisGraph, observations: ProbeObservation[]): DiagnosisState {
  return observations.reduce(
    (state, observation) => applyProbeResult(graph, state, observation.conceptId, observation.result),
    createDiagnosisState(graph),
  );
}

export function nextProbe(
  candidateIds: string[],
  state: DiagnosisState,
  depthMap: Record<string, number>,
): string | null {
  const unknown = candidateIds.filter((id) => state[id] === "unknown" && Number.isFinite(depthMap[id]));
  if (!unknown.length) return null;
  const depths = unknown.map((id) => depthMap[id]!).sort((left, right) => left - right);
  const middle = Math.floor(depths.length / 2);
  const median = depths.length % 2 ? depths[middle]! : (depths[middle - 1]! + depths[middle]!) / 2;
  return unknown.sort((left, right) => {
    const distance = Math.abs(depthMap[left]! - median) - Math.abs(depthMap[right]! - median);
    return distance || left.localeCompare(right);
  })[0] ?? null;
}

export function rootBlocker(
  graph: DiagnosisGraph,
  state: DiagnosisState,
  depthMap: Record<string, number> = graph.depthMap,
): string | null {
  const blockers = graph.conceptIds.filter((id) =>
    state[id] === "failed" && (graph.prerequisites[id] ?? []).every((prerequisite) => state[prerequisite] === "solved"),
  );
  return blockers.sort((left, right) => depthMap[right]! - depthMap[left]! || left.localeCompare(right))[0] ?? null;
}
