import { describe, expect, it } from "vitest";
import { applyProbeResult, createDiagnosisState, nextProbe, rootBlocker } from "../../lib/diagnosis/engine";
import { buildDiagnosisGraph } from "../../lib/diagnosis/graph";

const graph = buildDiagnosisGraph(
  [{ id: "a", depth: 0 }, { id: "b", depth: 1 }, { id: "c", depth: 2 }, { id: "d", depth: 3 }, { id: "e", depth: 2 }],
  [{ prerequisite_id: "a", dependent_id: "b" }, { prerequisite_id: "b", dependent_id: "c" }, { prerequisite_id: "c", dependent_id: "d" }, { prerequisite_id: "b", dependent_id: "e" }],
);

describe("diagnosis engine", () => {
  it("solved marks the concept and all transitive prerequisites solved", () => {
    expect(applyProbeResult(graph, createDiagnosisState(graph), "d", "solved")).toMatchObject({ a: "solved", b: "solved", c: "solved", d: "solved" });
  });

  it("solved does not propagate to dependents", () => {
    expect(applyProbeResult(graph, createDiagnosisState(graph), "b", "solved")).toMatchObject({ c: "unknown", d: "unknown", e: "unknown" });
  });

  it("failed marks the concept and all transitive dependents failed", () => {
    expect(applyProbeResult(graph, createDiagnosisState(graph), "b", "failed")).toMatchObject({ b: "failed", c: "failed", d: "failed", e: "failed" });
  });

  it("failed does not propagate to prerequisites", () => {
    expect(applyProbeResult(graph, createDiagnosisState(graph), "c", "failed").a).toBe("unknown");
  });

  it("skipped records only the selected concept", () => {
    expect(applyProbeResult(graph, createDiagnosisState(graph), "b", "skipped")).toEqual({ a: "unknown", b: "skipped", c: "unknown", d: "unknown", e: "unknown" });
  });

  it("nextProbe chooses the unknown node nearest the median depth", () => {
    expect(nextProbe(["a", "b", "c", "d"], createDiagnosisState(graph), graph.depthMap)).toBe("b");
  });

  it("nextProbe ignores concepts that are not unknown", () => {
    const state = { ...createDiagnosisState(graph), b: "solved" as const, c: "failed" as const };
    expect(nextProbe(["a", "b", "c", "d"], state, graph.depthMap)).toBe("a");
  });

  it("nextProbe breaks equal-distance ties by concept id", () => {
    expect(nextProbe(["e", "c"], createDiagnosisState(graph), graph.depthMap)).toBe("c");
  });

  it("rootBlocker returns the deepest failed concept whose direct prerequisites are solved", () => {
    const state = { ...createDiagnosisState(graph), a: "solved" as const, b: "solved" as const, c: "failed" as const, e: "failed" as const };
    expect(rootBlocker(graph, state)).toBe("c");
  });

  it("rootBlocker excludes a failed concept with an unsolved direct prerequisite", () => {
    const state = { ...createDiagnosisState(graph), b: "failed" as const, c: "failed" as const };
    expect(rootBlocker(graph, state)).toBeNull();
  });
});
