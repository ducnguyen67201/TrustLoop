import {
  SESSION_MATCH_CONFIDENCE,
  type SessionConversationMatch,
  type SessionRecordResponse,
  type SupportEvidence,
} from "@shared/types";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SupportEvidenceCapsule } from "../support-evidence-capsule";

const baseSession: SessionRecordResponse = {
  id: "sr_1",
  workspaceId: "ws_1",
  sessionId: "sess_1",
  userId: "u_1",
  userEmail: "marcus@northwind.io",
  userAgent: null,
  startedAt: "2026-04-23T14:20:00.000Z",
  lastEventAt: "2026-04-23T14:23:00.000Z",
  eventCount: 12,
  hasReplayData: true,
};

const baseMatch: SessionConversationMatch = {
  conversationId: "conv_1",
  sessionRecordId: "sr_1",
  matchSource: "conversation_email",
  matchConfidence: SESSION_MATCH_CONFIDENCE.confirmed,
  matchedIdentifierType: "email",
  matchedIdentifierValue: "marcus@northwind.io",
  score: 100,
  isPrimary: true,
  evidenceJson: null,
};

const baseEvidence: SupportEvidence = {
  primaryFailure: {
    eventId: "ex_1",
    type: "EXCEPTION",
    timestamp: "2026-04-23T14:22:12.000Z",
    title: "TypeError",
    description: "keys.map failed",
    severity: "error",
    status: null,
    url: null,
  },
  lastActions: [],
  failedRequests: [],
  consoleErrors: [],
  lastRoute: "/dashboard",
  eventsWindow: { returned: 12, total: 12, isTruncated: false, mode: "latest" },
  copy: { repro: "Repro text", escalation: "Escalation text" },
};

const renderCapsule = (
  overrides: Partial<React.ComponentProps<typeof SupportEvidenceCapsule>> = {}
) =>
  render(
    <SupportEvidenceCapsule
      isLoading={false}
      isAttachingSession={false}
      error={null}
      match={null}
      session={null}
      supportEvidence={null}
      matchConfidence={SESSION_MATCH_CONFIDENCE.none}
      manualAttachControl={<button type="button">Attach</button>}
      canViewProof={false}
      onViewProof={() => {}}
      {...overrides}
    />
  );

describe("SupportEvidenceCapsule", () => {
  afterEach(() => cleanup());

  it("shows the loading skeleton with the initial-load aria label", () => {
    renderCapsule({ isLoading: true });
    const card = screen.getByTestId("capsule-loading");
    expect(card.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Loading session evidence")).toBeDefined();
  });

  it("shows the loading skeleton with the attach aria label while attaching", () => {
    // Critical regression guard: before this, isAttachingSession=true with
    // session=null fell through to "No browser session matched" and the
    // operator's click felt unacknowledged.
    renderCapsule({ isAttachingSession: true });
    const card = screen.getByTestId("capsule-loading");
    expect(card.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Attaching session")).toBeDefined();
    expect(screen.queryByText("No browser session matched")).toBeNull();
  });

  it("shows the no-match empty state when no session is attached and nothing is loading", () => {
    renderCapsule();
    expect(screen.getByText("No browser session matched")).toBeDefined();
  });

  it("shows the re-correlation no-match message in the empty state", () => {
    renderCapsule({
      sessionActionMessage: "AI re-check finished, but no matching browser session was found.",
    });
    expect(
      screen.getByText("AI re-check finished, but no matching browser session was found.")
    ).toBeDefined();
  });

  it("renders the populated capsule when a session is attached with evidence", () => {
    renderCapsule({
      session: baseSession,
      match: baseMatch,
      matchConfidence: SESSION_MATCH_CONFIDENCE.confirmed,
      supportEvidence: baseEvidence,
      canViewProof: true,
    });
    expect(screen.getByText("Support evidence")).toBeDefined();
    // The capsule renders the primary failure title in multiple slots
    // (header + tabbed list); "at least one" is the meaningful assertion.
    expect(screen.getAllByText("TypeError").length).toBeGreaterThan(0);
  });

  it("surfaces a lookup error in a destructive card", () => {
    renderCapsule({ error: "Network timed out" });
    expect(screen.getByText("Session lookup failed")).toBeDefined();
    expect(screen.getByText("Network timed out")).toBeDefined();
  });

  it("loading state takes priority over a stale error", () => {
    // If a previous attempt errored and the operator retries, we should
    // show the loading skeleton, not flash the old error message.
    renderCapsule({ isLoading: true, error: "Previous failure" });
    expect(screen.getByTestId("capsule-loading")).toBeDefined();
    expect(screen.queryByText("Session lookup failed")).toBeNull();
  });
});
