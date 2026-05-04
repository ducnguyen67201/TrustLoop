// Integration test for the operator-facing session tab. Renders the real
// SessionTab + SupportEvidenceCapsule together, mocks only the heavy
// downstream children (timeline, replay modal, manual-attach dialog), and
// drives the full client-side happy path: render → copy → view proof.
//
// Why this lives at the SessionTab level: PR5 has a unit test for the
// capsule alone, but it doesn't cover the wiring — manual-attach control
// rendering, "View proof" → onLoadReplayChunks dispatch, the early-return
// for "no session, show SDK setup guide". This test catches breakage in
// the composition that the capsule unit test would miss.

import {
  SESSION_MATCH_CONFIDENCE,
  type SessionConversationMatch,
  type SessionRecordResponse,
  type SupportEvidence,
} from "@shared/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock heavy children ─────────────────────────────────────────────
// We're testing the composition + capsule, not these. Lighter mocks let
// the test focus on the operator's observable surface.

vi.mock("@/components/session-replay/session-event-timeline", () => ({
  SessionEventTimeline: () => <div data-testid="event-timeline" />,
}));

vi.mock("@/components/session-replay/session-replay-modal", () => ({
  SessionReplayModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="replay-modal-open" /> : null,
}));

vi.mock("@/components/session-replay/session-manual-attach-dialog", () => ({
  SessionManualAttachDialog: ({ triggerLabel }: { triggerLabel: string }) => (
    <button type="button" data-testid="manual-attach-trigger">
      {triggerLabel}
    </button>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Imports after mocks so they pick up the fakes.
const { SessionTab } = await import("../session-tab");

// ── Fixtures ────────────────────────────────────────────────────────

const matchedSession: SessionRecordResponse = {
  id: "sr_1",
  workspaceId: "ws_1",
  sessionId: "sess_marcus_1",
  userId: "u_1",
  userEmail: "marcus@northwind.io",
  userAgent: null,
  startedAt: "2026-04-23T14:20:00.000Z",
  lastEventAt: "2026-04-23T14:23:00.000Z",
  eventCount: 12,
  hasReplayData: true,
};

const confirmedMatch: SessionConversationMatch = {
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

const evidence: SupportEvidence = {
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
  copy: {
    repro: "Repro evidence text marcus saw an exception",
    escalation: "Escalation evidence text",
  },
};

const defaultProps = {
  workspaceId: "ws_1",
  isLoading: false,
  error: null,
  match: null,
  session: null,
  supportEvidence: null,
  matchConfidence: SESSION_MATCH_CONFIDENCE.none,
  events: [],
  isLoadingEvents: false,
  failurePointId: null,
  replayChunks: [],
  totalReplayChunks: 0,
  isLoadingReplayChunks: false,
  replayLoadError: null,
  isAttachingSession: false,
  attachSessionError: null,
  onAttachSession: vi.fn().mockResolvedValue(undefined),
  onRetryReplayLoad: vi.fn(),
  onLoadReplayChunks: vi.fn(),
};

const matchedProps = {
  ...defaultProps,
  match: confirmedMatch,
  session: matchedSession,
  supportEvidence: evidence,
  matchConfidence: SESSION_MATCH_CONFIDENCE.confirmed,
};

// ── Tests ───────────────────────────────────────────────────────────

describe("SessionTab integration", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the SDK setup guide CTA when no session matches and nothing is loading", () => {
    render(<SessionTab {...defaultProps} />);
    expect(screen.getByText("No browser session matched")).toBeDefined();
    const sdkLink = screen.getByText("SDK setup guide").closest("a");
    expect(sdkLink?.getAttribute("href")).toBe("/docs/sdk-install");
  });

  it("wires the empty-state Re-attach AI button and shows a completed no-match message", () => {
    const onRecorrelateSession = vi.fn().mockResolvedValue(undefined);
    render(
      <SessionTab
        {...defaultProps}
        onRecorrelateSession={onRecorrelateSession}
        sessionActionMessage="AI re-check finished, but no matching browser session was found."
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Re-attach \(AI\)/ }));

    expect(onRecorrelateSession).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("AI re-check finished, but no matching browser session was found.")
    ).toBeDefined();
  });

  it("renders the populated capsule + timeline + replay button when matched", () => {
    render(<SessionTab {...matchedProps} />);
    expect(screen.getByText("Support evidence")).toBeDefined();
    expect(screen.getByTestId("event-timeline")).toBeDefined();
    // hasReplayData=true → "Open Replay" button should render
    expect(screen.getByText("Open Replay")).toBeDefined();
    // Modal starts closed
    expect(screen.queryByTestId("replay-modal-open")).toBeNull();
  });

  it("clicking 'Copy repro' writes the redacted repro text to the clipboard", async () => {
    render(<SessionTab {...matchedProps} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: /Evidence actions/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Copy repro/ }));

    // Microtask: handleCopy is async, settle the clipboard call.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writeText).toHaveBeenCalledTimes(1);
    const written = writeText.mock.calls[0]?.[0] ?? "";
    // The capsule appends match-context lines, so we assert on the meaningful
    // substring (the schema-built repro text) rather than exact equality.
    expect(written).toContain("Repro evidence text");
  });

  it("clicking 'View proof' opens the replay modal and triggers chunk load", () => {
    const onLoadReplayChunks = vi.fn();
    render(<SessionTab {...matchedProps} onLoadReplayChunks={onLoadReplayChunks} />);

    fireEvent.click(screen.getByRole("button", { name: /View proof/ }));

    expect(onLoadReplayChunks).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("replay-modal-open")).toBeDefined();
  });

  it("hides the empty-state CTA while the initial correlation is in flight", () => {
    // Loading state: capsule renders its skeleton (no text content) and the
    // SDK setup guide must NOT show — that's the post-load empty surface,
    // not an in-flight fallback. The capsule's loading rendering is asserted
    // via its own unit test; here we verify the SessionTab early-return gates
    // correctly on isLoading.
    render(<SessionTab {...defaultProps} isLoading={true} />);
    expect(screen.queryByText("No browser session matched")).toBeNull();
    expect(screen.queryByText("SDK setup guide")).toBeNull();
    expect(screen.queryByText("Support evidence")).toBeNull();
  });

  it("shows 'no DOM replay' note when session matched but hasReplayData is false", () => {
    const noReplaySession = { ...matchedSession, hasReplayData: false };
    render(<SessionTab {...matchedProps} session={noReplaySession} />);
    expect(
      screen.getByText("Structured events only. No DOM replay was captured for this session.")
    ).toBeDefined();
    // "Open Replay" CTA should NOT render when there are no chunks to view.
    expect(screen.queryByText("Open Replay")).toBeNull();
  });
});
