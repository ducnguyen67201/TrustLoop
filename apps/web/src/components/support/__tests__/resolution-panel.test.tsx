import type {
  GetPendingResolutionQuestionsResponse,
  PendingResolutionQuestion,
} from "@shared/types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockTrpcQuery = vi.fn();
const mockTrpcMutation = vi.fn();

vi.mock("@/lib/trpc-http", () => ({
  trpcQuery: (...args: unknown[]) => mockTrpcQuery(...args),
  trpcMutation: (...args: unknown[]) => mockTrpcMutation(...args),
}));

import { ResolutionPanel } from "../resolution-panel";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mockTrpcQuery.mockReset();
  mockTrpcMutation.mockReset();
});

const operatorQuestion: PendingResolutionQuestion = {
  questionId: "run_1-0-0",
  askedByRoleKey: "architect",
  target: "operator",
  question: "What's the customer's plan tier?",
  suggestedReply: null,
  assignedRole: null,
  dispatchedAt: new Date("2026-04-25T10:00:00.000Z").toISOString(),
};

const customerQuestion: PendingResolutionQuestion = {
  questionId: "run_1-0-1",
  askedByRoleKey: "architect",
  target: "customer",
  question: "Could you share the error code?",
  suggestedReply: "Hey — could you share the error code from the dashboard?",
  assignedRole: null,
  dispatchedAt: new Date("2026-04-25T10:00:01.000Z").toISOString(),
};

const roleLabels = new Map<string, string>([["architect", "Architect"]]);

function mockPendingResponse(response: GetPendingResolutionQuestionsResponse) {
  mockTrpcQuery.mockResolvedValue(response);
}

describe("ResolutionPanel", () => {
  it("renders operator-target question with answer textarea and Save button", async () => {
    mockPendingResponse([operatorQuestion]);

    render(<ResolutionPanel runId="run_1" runStatus="waiting" roleLabels={roleLabels} />);

    await waitFor(() => {
      expect(screen.getByText("What's the customer's plan tier?")).toBeTruthy();
    });

    const textarea = screen.getByTestId("resolution-operator-answer-input");
    const submit = screen.getByTestId("resolution-operator-answer-submit");
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: "Pro tier, billing is current." } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls recordOperatorAnswer when the operator saves an answer", async () => {
    mockPendingResponse([operatorQuestion]);
    mockTrpcMutation.mockResolvedValue({ messageId: "msg_synthetic" });

    render(<ResolutionPanel runId="run_1" runStatus="waiting" roleLabels={roleLabels} />);

    await waitFor(() => screen.getByTestId("resolution-operator-answer-input"));

    fireEvent.change(screen.getByTestId("resolution-operator-answer-input"), {
      target: { value: "Pro tier, billing is current." },
    });
    fireEvent.click(screen.getByTestId("resolution-operator-answer-submit"));

    await waitFor(() => {
      expect(mockTrpcMutation).toHaveBeenCalledWith(
        "agentTeam.recordOperatorAnswer",
        {
          runId: "run_1",
          questionId: "run_1-0-0",
          answer: "Pro tier, billing is current.",
        },
        { withCsrf: true }
      );
    });
  });

  it("renders customer-target suggested reply with a Copy button", async () => {
    mockPendingResponse([customerQuestion]);

    render(<ResolutionPanel runId="run_1" runStatus="waiting" roleLabels={roleLabels} />);

    await waitFor(() => {
      expect(
        screen.getByText("Hey — could you share the error code from the dashboard?")
      ).toBeTruthy();
    });
    expect(screen.getByTestId("resolution-customer-copy")).toBeTruthy();
  });

  it("flips Copy button to 'Copied' optimistically even when clipboard write rejects", async () => {
    mockPendingResponse([customerQuestion]);
    // Simulate a locked-down browser: writeText rejects, but the UI must
    // still confirm the click registered so the operator isn't left
    // wondering whether the button worked.
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard blocked"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<ResolutionPanel runId="run_1" runStatus="waiting" roleLabels={roleLabels} />);

    await waitFor(() => screen.getByTestId("resolution-customer-copy"));
    fireEvent.click(screen.getByTestId("resolution-customer-copy"));

    await waitFor(() => {
      expect(screen.getByTestId("resolution-customer-copy").textContent).toContain("Copied");
    });
    expect(writeText).toHaveBeenCalledWith(
      "Hey — could you share the error code from the dashboard?"
    );
  });

  it("disables Resume button when run is not in waiting status", async () => {
    mockPendingResponse([operatorQuestion]);

    render(<ResolutionPanel runId="run_1" runStatus="running" roleLabels={roleLabels} />);

    await waitFor(() => screen.getByTestId("resolution-resume-button"));
    const resumeButton = screen.getByTestId("resolution-resume-button") as HTMLButtonElement;
    expect(resumeButton.disabled).toBe(true);
  });

  it("calls resumeRun mutation when Resume is clicked while waiting", async () => {
    mockPendingResponse([]);
    mockTrpcMutation.mockResolvedValue({
      workflowId: "agent-team-run-run_1-resume-1",
      runId: "temporal_run",
      queue: "codex-intensive",
    });

    render(<ResolutionPanel runId="run_1" runStatus="waiting" roleLabels={roleLabels} />);

    await waitFor(() => screen.getByTestId("resolution-resume-button"));
    fireEvent.click(screen.getByTestId("resolution-resume-button"));

    await waitFor(() => {
      expect(mockTrpcMutation).toHaveBeenCalledWith(
        "agentTeam.resumeRun",
        { runId: "run_1" },
        { withCsrf: true }
      );
    });
  });
});
