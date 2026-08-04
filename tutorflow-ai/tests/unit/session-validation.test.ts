import { describe, expect, it } from "vitest";
import { sessionInputSchema } from "../../lib/validation/session";

const valid = { studentId: "10000000-0000-4000-8000-000000000001", sessionDate: "2026-08-03", topic: "Algebra", understanding: 3, summary: "Reviewed factoring.", usedMaterialIds: [] };

describe("session input validation", () => {
  it("rejects understanding = 0", () => expect(sessionInputSchema.safeParse({ ...valid, understanding: 0 }).success).toBe(false));
  it("rejects understanding = 6", () => expect(sessionInputSchema.safeParse({ ...valid, understanding: 6 }).success).toBe(false));
  it("rejects understanding = 3.5", () => expect(sessionInputSchema.safeParse({ ...valid, understanding: 3.5 }).success).toBe(false));
  it("accepts understanding 1 through 5", () => { for (const understanding of [1,2,3,4,5]) expect(sessionInputSchema.safeParse({ ...valid, understanding }).success).toBe(true); });
  it("rejects empty summary", () => expect(sessionInputSchema.safeParse({ ...valid, summary: "" }).success).toBe(false));
  it("rejects summary over 2000 chars", () => expect(sessionInputSchema.safeParse({ ...valid, summary: "a".repeat(2001) }).success).toBe(false));
  it("trims whitespace-only topic and rejects", () => expect(sessionInputSchema.safeParse({ ...valid, topic: "   " }).success).toBe(false));
});
