import type { AgentPrSummary } from "@shared/rest/services/codex/agent-pr-service";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const trpcQuery = vi.fn();
vi.mock("@/lib/trpc-http", () => ({
  trpcQuery: (...args: unknown[]) => trpcQuery(...args),
}));

const { AgentPrList } = await import("../agent-pr-list");

const SAMPLE: AgentPrSummary = {
  id: "apr_1",
  prNumber: 42,
  prUrl: "https://github.com/acme/repo/pull/42",
  branchName: "trustloop/fix-1",
  baseBranch: "main",
  title: "Fix",
  status: "open",
  repositoryFullName: "acme/repo",
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  trpcQuery.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("AgentPrList", () => {
  it("renders nothing when the list is empty", async () => {
    trpcQuery.mockResolvedValueOnce([]);
    const { container } = render(<AgentPrList conversationId="conv_1" refetchKey="ANALYZED" />);
    await waitFor(() => expect(trpcQuery).toHaveBeenCalled());
    expect(container.children.length).toBe(0);
  });

  it("renders a pill per PR with correct href and target", async () => {
    trpcQuery.mockResolvedValueOnce([SAMPLE]);
    render(<AgentPrList conversationId="conv_1" refetchKey="ANALYZED" />);
    const link = await screen.findByRole("link", { name: /Draft PR #42/ });
    expect(link.getAttribute("href")).toBe(SAMPLE.prUrl);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps previously rendered pills on transient fetch error", async () => {
    // First render: list arrives, pill renders.
    trpcQuery.mockResolvedValueOnce([SAMPLE]);
    const { rerender } = render(<AgentPrList conversationId="conv_1" refetchKey="ANALYZING" />);
    await screen.findByRole("link", { name: /Draft PR #42/ });

    // Second render: fetch rejects. Pill must NOT disappear.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    trpcQuery.mockRejectedValueOnce(new Error("network blip"));
    rerender(<AgentPrList conversationId="conv_1" refetchKey="ANALYZED" />);
    await waitFor(() => expect(warnSpy).toHaveBeenCalled());
    // Still in the DOM — clobbering would have removed the link.
    expect(screen.getByRole("link", { name: /Draft PR #42/ })).toBeTruthy();
    warnSpy.mockRestore();
  });
});
