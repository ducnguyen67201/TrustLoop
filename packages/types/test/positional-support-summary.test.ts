import {
  POSITIONAL_SUMMARY_FORMAT_INSTRUCTIONS,
  compressedSummaryOutputSchema,
  reconstructSummaryOutput,
} from "@shared/types/positional-format/support-summary";
import { describe, expect, it } from "vitest";

describe("positional-format/support-summary", () => {
  describe("compressedSummaryOutputSchema", () => {
    it("accepts a typical summary", () => {
      const parsed = compressedSummaryOutputSchema.parse({
        s: "Customer asking for help fixing an OAuth redirect loop",
      });
      expect(parsed.s).toBe("Customer asking for help fixing an OAuth redirect loop");
    });

    it("rejects empty string (Zod min guard)", () => {
      expect(() => compressedSummaryOutputSchema.parse({ s: "" })).toThrow();
    });

    it("rejects whitespace-only string (Zod trim+min)", () => {
      expect(() => compressedSummaryOutputSchema.parse({ s: "   " })).toThrow();
    });

    it("rejects a summary past the 120-char cap", () => {
      const tooLong = "a".repeat(121);
      expect(() => compressedSummaryOutputSchema.parse({ s: tooLong })).toThrow();
    });

    it("rejects extra keys (strict schema)", () => {
      expect(() =>
        compressedSummaryOutputSchema.parse({
          s: "ok",
          extra: "nope",
        })
      ).toThrow();
    });
  });

  describe("reconstructSummaryOutput", () => {
    it("maps s → summary", () => {
      const result = reconstructSummaryOutput({ s: "Customer reporting invoice math is off" });
      expect(result).toEqual({ summary: "Customer reporting invoice math is off" });
    });
  });

  describe("POSITIONAL_SUMMARY_FORMAT_INSTRUCTIONS", () => {
    it("is a non-empty string including both example shapes", () => {
      expect(POSITIONAL_SUMMARY_FORMAT_INSTRUCTIONS).toContain('{"s":"');
      expect(POSITIONAL_SUMMARY_FORMAT_INSTRUCTIONS).toContain("customer");
    });
  });
});
