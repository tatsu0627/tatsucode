import type { DiagnosisConcept, DiagnosisEdge, DiagnosisGraph } from "./types";

export function buildDiagnosisGraph(concepts: DiagnosisConcept[], edges: DiagnosisEdge[]): DiagnosisGraph {
  const conceptIds = concepts.map((concept) => concept.id).sort((left, right) => left.localeCompare(right));
  const known = new Set(conceptIds);
  const prerequisites = Object.fromEntries(conceptIds.map((id) => [id, [] as string[]]));
  const dependents = Object.fromEntries(conceptIds.map((id) => [id, [] as string[]]));
  const depthMap = Object.fromEntries(concepts.map((concept) => [concept.id, concept.depth]));
  for (const edge of edges) {
    if (!known.has(edge.prerequisite_id) || !known.has(edge.dependent_id)) throw new Error("unknown_concept_edge");
    if (edge.prerequisite_id === edge.dependent_id) throw new Error("self_referencing_concept_edge");
    prerequisites[edge.dependent_id]!.push(edge.prerequisite_id);
    dependents[edge.prerequisite_id]!.push(edge.dependent_id);
  }
  for (const id of conceptIds) {
    prerequisites[id]!.sort((left, right) => left.localeCompare(right));
    dependents[id]!.sort((left, right) => left.localeCompare(right));
  }
  assertAcyclic(conceptIds, dependents);
  return { conceptIds, prerequisites, dependents, depthMap };
}

function assertAcyclic(conceptIds: string[], dependents: Record<string, string[]>) {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new Error("cyclic_concept_graph");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependent of dependents[id] ?? []) visit(dependent);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of conceptIds) visit(id);
}

export function prerequisiteClosure(graph: DiagnosisGraph, conceptId: string): string[] {
  if (!(conceptId in graph.depthMap)) throw new Error("unknown_concept");
  const seen = new Set<string>();
  const queue = [...(graph.prerequisites[conceptId] ?? [])];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(graph.prerequisites[id] ?? []));
  }
  return [...seen].sort((left, right) => graph.depthMap[left]! - graph.depthMap[right]! || left.localeCompare(right));
}

export function diagnosticCandidates(graph: DiagnosisGraph, targetConceptId: string): string[] {
  return [...prerequisiteClosure(graph, targetConceptId), targetConceptId]
    .sort((left, right) => graph.depthMap[left]! - graph.depthMap[right]! || left.localeCompare(right));
}
