import { describe, expect, it } from "vitest";
import { buildDiagnosisGraph, diagnosticCandidates, prerequisiteClosure } from "../../lib/diagnosis/graph";

const concepts = [{ id: "a", depth: 0 }, { id: "b", depth: 1 }, { id: "c", depth: 2 }, { id: "d", depth: 1 }];
const edges = [{ prerequisite_id: "a", dependent_id: "b" }, { prerequisite_id: "b", dependent_id: "c" }, { prerequisite_id: "a", dependent_id: "d" }];

describe("diagnosis graph", () => {
  it("builds sorted prerequisite and dependent indexes", () => {
    const graph = buildDiagnosisGraph(concepts, edges);
    expect(graph.prerequisites.c).toEqual(["b"]);
    expect(graph.dependents.a).toEqual(["b", "d"]);
    expect(graph.depthMap.c).toBe(2);
  });

  it("returns the transitive prerequisite closure and target", () => {
    const graph = buildDiagnosisGraph(concepts, edges);
    expect(prerequisiteClosure(graph, "c")).toEqual(["a", "b"]);
    expect(diagnosticCandidates(graph, "c")).toEqual(["a", "b", "c"]);
  });

  it("rejects cyclic concept edges", () => {
    expect(() => buildDiagnosisGraph(concepts, [...edges, { prerequisite_id: "c", dependent_id: "a" }])).toThrow("cyclic_concept_graph");
  });
});
