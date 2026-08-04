import type { Concept, ConceptEdge, ProbeResult } from "@/lib/db/types";

export type DiagnosisStatus = "unknown" | ProbeResult;
export type DiagnosisState = Record<string, DiagnosisStatus>;
export type DiagnosisConcept = Pick<Concept, "id" | "depth">;
export type DiagnosisEdge = Pick<ConceptEdge, "prerequisite_id" | "dependent_id">;

export type DiagnosisGraph = {
  conceptIds: string[];
  prerequisites: Record<string, string[]>;
  dependents: Record<string, string[]>;
  depthMap: Record<string, number>;
};

export type ProbeObservation = { conceptId: string; result: ProbeResult };
