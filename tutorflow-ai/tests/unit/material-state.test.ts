import { describe, expect, it } from "vitest";
import { canAttachToSession, nextState } from "../../lib/validation/material";

describe("material state", () => {
  it("canAttachToSession returns false for unverified", () => expect(canAttachToSession("unverified")).toBe(false));
  it("canAttachToSession returns false for discarded", () => expect(canAttachToSession("discarded")).toBe(false));
  it("canAttachToSession returns true for verified", () => expect(canAttachToSession("verified")).toBe(true));
  it("nextState rejects verified to unverified", () => expect(() => nextState("verified", "unverified")).toThrow());
  it("nextState rejects verified to discarded", () => expect(() => nextState("verified", "discarded")).toThrow());
  it("nextState rejects verified -> verified", () => {
    expect(() => nextState("verified", "verified")).toThrow();
  });
});
