import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ConfidenceBadge } from "../confidence-badge";

describe("ConfidenceBadge", () => {
  afterEach(() => cleanup());
  it("renders green for high confidence (>0.7)", () => {
    render(<ConfidenceBadge confidence={0.85} />);
    const badge = screen.getByText("High confidence");
    expect(badge).toBeDefined();
    expect(badge.className).toContain("emerald");
  });

  it("renders yellow for medium confidence (0.4-0.7)", () => {
    render(<ConfidenceBadge confidence={0.55} />);
    const badge = screen.getByText("Review carefully");
    expect(badge).toBeDefined();
    expect(badge.className).toContain("amber");
  });

  it("renders red for low confidence (<0.4)", () => {
    render(<ConfidenceBadge confidence={0.2} />);
    const badge = screen.getByText("Needs attention");
    expect(badge).toBeDefined();
    expect(badge.className).toContain("red");
  });

  it("includes aria-label with percentage", () => {
    render(<ConfidenceBadge confidence={0.92} />);
    const badge = screen.getByLabelText("High confidence: 92% confidence");
    expect(badge).toBeDefined();
  });

  it("handles boundary value 0.7 as medium", () => {
    render(<ConfidenceBadge confidence={0.7} />);
    expect(screen.getByText("Review carefully")).toBeDefined();
  });

  it("handles boundary value 0.4 as low", () => {
    render(<ConfidenceBadge confidence={0.4} />);
    expect(screen.getByText("Needs attention")).toBeDefined();
  });

  it("handles 0 confidence", () => {
    render(<ConfidenceBadge confidence={0} />);
    expect(screen.getByText("Needs attention")).toBeDefined();
  });

  it("handles 1.0 confidence", () => {
    render(<ConfidenceBadge confidence={1.0} />);
    expect(screen.getByText("High confidence")).toBeDefined();
  });
});
