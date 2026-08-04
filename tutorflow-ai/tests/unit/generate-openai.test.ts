import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { parseMock } = vi.hoisted(() => ({ parseMock: vi.fn() }));

vi.mock("../../lib/ai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: parseMock } }),
}));

import { generateMaterialDraft } from "../../lib/ai/generate";

const request = {
  studentId: "10000000-0000-4000-8000-000000000001",
  topic: "Linear equations",
  difficulty: "standard" as const,
  problemCount: 1,
  learningObjective: "Solve equations and verify the result",
};

const draft = {
  topic: request.topic,
  difficulty: request.difficulty,
  learning_objective: request.learningObjective,
  problems: [{
    question: "Solve 2x + 3 = 11.",
    hints: ["Subtract 3 first."],
    solution_steps: ["2x = 8", "x = 4"],
    common_mistakes: ["Dividing before subtracting."],
  }],
  review_warning: "AI-generated draft. Verify all mathematics before use.",
};

function response(overrides: Record<string, unknown> = {}) {
  return {
    status: "completed",
    output: [],
    incomplete_details: null,
    output_parsed: draft,
    ...overrides,
  };
}

describe("OpenAI material generation", () => {
  beforeEach(() => {
    vi.stubEnv("MOCK_AI", "0");
    vi.stubEnv("AI_MODEL", "gpt-5.6-luna");
    vi.stubEnv("AI_EFFORT", "medium");
    parseMock.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("uses GPT-5.6 Luna with Responses structured output", async () => {
    parseMock.mockResolvedValue(response());

    await expect(generateMaterialDraft(request)).resolves.toMatchObject({ draft, modelLabel: "gpt-5.6-luna" });
    expect(parseMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-luna",
      max_output_tokens: 16000,
      reasoning: { effort: "medium" },
      store: false,
      input: expect.stringContaining("Topic: Linear equations"),
      text: { format: expect.objectContaining({ type: "json_schema", name: "material_draft", strict: true }) },
    }));
  });

  it("rejects a refusal before parsing a draft", async () => {
    parseMock.mockResolvedValue(response({
      output: [{ type: "message", content: [{ type: "refusal", refusal: "Cannot comply." }] }],
      output_parsed: null,
    }));

    await expect(generateMaterialDraft(request)).rejects.toEqual(expect.objectContaining({ message: "refused" }));
  });

  it("reports output-token truncation as invalid output", async () => {
    parseMock.mockResolvedValue(response({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_parsed: null,
    }));

    await expect(generateMaterialDraft(request)).rejects.toEqual(expect.objectContaining({ message: "truncated" }));
  });

  it("rejects a completed response without parsed structured output", async () => {
    parseMock.mockResolvedValue(response({ output_parsed: null }));

    await expect(generateMaterialDraft(request)).rejects.toEqual(expect.objectContaining({ message: "schema_parse_failed" }));
  });

  it("maps failed Responses status to an unavailable error", async () => {
    parseMock.mockResolvedValue(response({ status: "failed", output_parsed: null }));

    await expect(generateMaterialDraft(request)).rejects.toEqual(expect.objectContaining({ message: "response_failed" }));
  });
});
