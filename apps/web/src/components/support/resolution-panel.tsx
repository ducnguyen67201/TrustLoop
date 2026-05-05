"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useResolutionQuestions } from "@/hooks/use-resolution-questions";
import { getAgentRoleColorStyle } from "@/lib/agent-team/role-metadata";
import {
  RiCheckboxCircleLine,
  RiClipboardLine,
  RiPlayCircleLine,
  RiUserVoiceLine,
} from "@remixicon/react";
import { AGENT_TEAM_RUN_STATUS, type PendingResolutionQuestion } from "@shared/types";
import { useState } from "react";

interface ResolutionPanelProps {
  runId: string;
  runStatus: string;
  roleLabels: Map<string, string>;
  onRunResumed?: () => void;
}

/**
 * Operator-facing panel for runs that exited to `waiting`. Shows every
 * unanswered question the architect dispatched, grouped by target. The
 * operator answers operator-target questions inline (via
 * agentTeam.recordOperatorAnswer), copies customer-target suggested
 * replies into Slack, and triggers an explicit resume via
 * agentTeam.resumeRun once they're ready for the architect to pick the
 * answers up.
 */
export function ResolutionPanel({
  runId,
  runStatus,
  roleLabels,
  onRunResumed,
}: ResolutionPanelProps) {
  const { pending, isLoading, error, isAnswering, isResuming, recordAnswer, resumeRun } =
    useResolutionQuestions({
      runId,
      enabled: true,
      onRunResumed,
    });

  const isWaiting = runStatus === AGENT_TEAM_RUN_STATUS.waiting;
  const operatorPending = pending.filter((q) => q.target === "operator");
  const customerPending = pending.filter((q) => q.target === "customer");
  const internalPending = pending.filter((q) => q.target === "internal");
  const operatorAnswered = isWaiting && operatorPending.length === 0;
  const waitingOnCustomer = isWaiting && customerPending.length > 0;

  if (isLoading && pending.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading resolution questions…</p>;
  }

  if (pending.length === 0 && !isWaiting) {
    return (
      <EmptyState
        title="No pending questions"
        description="The architect has nothing waiting on the operator. Pending questions surface here when a run exits to waiting."
      />
    );
  }

  if (pending.length === 0 && isWaiting) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Run is waiting but no questions are open. The operator can resume the run when ready.
        </p>
        <ResumeButton
          isResuming={isResuming}
          onClick={() => void resumeRun()}
          disabled={!isWaiting}
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      {operatorPending.length > 0 ? (
        <Section
          title={`Operator questions (${operatorPending.length})`}
          description="Type the answer the architect needs. Saved answers wake the architect's inbox; the run only restarts when you click Resume."
        >
          {operatorPending.map((question) => (
            <OperatorQuestionRow
              key={question.questionId}
              question={question}
              roleLabels={roleLabels}
              isSubmitting={isAnswering}
              onSubmit={(answer) => recordAnswer(question.questionId, answer)}
            />
          ))}
        </Section>
      ) : null}

      {customerPending.length > 0 ? (
        <Section
          title={`Customer-bound suggestions (${customerPending.length})`}
          description="The architect drafted a reply in your voice. Copy it into the Slack reply when you're ready to ask the customer."
        >
          {customerPending.map((question) => (
            <CustomerQuestionRow
              key={question.questionId}
              question={question}
              roleLabels={roleLabels}
            />
          ))}
        </Section>
      ) : null}

      {internalPending.length > 0 ? (
        <Section
          title={`Routed to peer roles (${internalPending.length})`}
          description="Other roles will pick these up on their next turn. Listed here so you can see what the architect is waiting on."
        >
          {internalPending.map((question) => (
            <InternalQuestionRow
              key={question.questionId}
              question={question}
              roleLabels={roleLabels}
            />
          ))}
        </Section>
      ) : null}

      <div className="rounded-md border border-border/50 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {waitingOnCustomer ? (
              <span className="flex items-center gap-1.5 text-amber-700">
                <RiUserVoiceLine className="h-4 w-4" />
                Waiting on customer reply. Copy the draft into Slack, then resume after the customer
                responds.
              </span>
            ) : operatorAnswered ? (
              <span className="flex items-center gap-1.5 text-emerald-700">
                <RiCheckboxCircleLine className="h-4 w-4" />
                All operator questions answered. Resume to wake the architect.
              </span>
            ) : (
              <span>
                {operatorPending.length} operator{" "}
                {operatorPending.length === 1 ? "question" : "questions"} still open. Resume anyway
                if the architect should re-evaluate without all answers.
              </span>
            )}
          </div>
          <ResumeButton
            isResuming={isResuming}
            onClick={() => void resumeRun()}
            disabled={!isWaiting}
          />
        </div>
        {!isWaiting ? (
          <p className="mt-2 text-[11px] text-muted-foreground/70">
            Resume is only available while the run is in <code>waiting</code>. Current status:{" "}
            <code>{runStatus}</code>.
          </p>
        ) : null}
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

function ResumeButton({
  disabled,
  isResuming,
  onClick,
}: {
  disabled: boolean;
  isResuming: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      onClick={onClick}
      disabled={disabled || isResuming}
      data-testid="resolution-resume-button"
    >
      <RiPlayCircleLine className="h-4 w-4" />
      {isResuming ? "Resuming…" : "Resume run"}
    </Button>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <header className="space-y-0.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground/80">{description}</p>
      </header>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function OperatorQuestionRow({
  question,
  roleLabels,
  isSubmitting,
  onSubmit,
}: {
  question: PendingResolutionQuestion;
  roleLabels: Map<string, string>;
  isSubmitting: boolean;
  onSubmit: (answer: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !isSubmitting;
  const askedBy = roleLabels.get(question.askedByRoleKey) ?? question.askedByRoleKey;

  return (
    <div
      className="rounded-md border border-border/50 p-3"
      data-testid="resolution-operator-question"
    >
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
          <RiUserVoiceLine className="mr-1 h-3 w-3" />
          operator
        </Badge>
        <span
          className="text-[11px] font-medium"
          style={getAgentRoleColorStyle(question.askedByRoleKey)}
          title={question.askedByRoleKey}
        >
          {askedBy}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-foreground">{question.question}</p>
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Type the answer the architect needs to keep going…"
        rows={3}
        disabled={isSubmitting}
        className="mt-3 text-sm"
        data-testid="resolution-operator-answer-input"
      />
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={!canSubmit}
          onClick={() => {
            if (!canSubmit) return;
            void onSubmit(trimmed).then(() => setDraft(""));
          }}
          data-testid="resolution-operator-answer-submit"
        >
          {isSubmitting ? "Saving…" : "Save answer"}
        </Button>
      </div>
    </div>
  );
}

function CustomerQuestionRow({
  question,
  roleLabels,
}: {
  question: PendingResolutionQuestion;
  roleLabels: Map<string, string>;
}) {
  const [copied, setCopied] = useState(false);
  const askedBy = roleLabels.get(question.askedByRoleKey) ?? question.askedByRoleKey;
  const draftToCopy = question.suggestedReply ?? question.question;

  const handleCopy = async () => {
    // Optimistic feedback: flip the label first so the operator sees the
    // click registered. If the Clipboard API rejects (corporate policy,
    // restricted iframe, headless context), the visible draft text is
    // still selectable as a fallback — but the button must not look dead.
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    try {
      await navigator.clipboard.writeText(draftToCopy);
    } catch {
      // No-op. Operator can select-and-copy the visible text manually.
    }
  };

  return (
    <div
      className="rounded-md border border-border/50 p-3"
      data-testid="resolution-customer-question"
    >
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
          customer
        </Badge>
        <span
          className="text-[11px] font-medium"
          style={getAgentRoleColorStyle(question.askedByRoleKey)}
          title={question.askedByRoleKey}
        >
          {askedBy}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-foreground">{question.question}</p>
      {question.suggestedReply ? (
        <div className="mt-3 rounded-md border border-dashed border-border/60 bg-muted/40 p-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Suggested reply
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{question.suggestedReply}</p>
        </div>
      ) : null}
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCopy}
          data-testid="resolution-customer-copy"
        >
          <RiClipboardLine className="h-4 w-4" />
          {copied ? "Copied" : "Copy reply"}
        </Button>
      </div>
    </div>
  );
}

function InternalQuestionRow({
  question,
  roleLabels,
}: {
  question: PendingResolutionQuestion;
  roleLabels: Map<string, string>;
}) {
  const askedBy = roleLabels.get(question.askedByRoleKey) ?? question.askedByRoleKey;
  const assigned = question.assignedRole
    ? (roleLabels.get(question.assignedRole) ?? question.assignedRole)
    : "unassigned";

  return (
    <div
      className="rounded-md border border-border/50 p-3"
      data-testid="resolution-internal-question"
    >
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline">internal</Badge>
        <span className="text-[11px] text-muted-foreground">
          {askedBy} → {assigned}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-foreground">{question.question}</p>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
      <div className="rounded-full border border-border/50 p-2">
        <RiCheckboxCircleLine className="h-4 w-4" />
      </div>
      <p className="font-medium text-foreground">{title}</p>
      <p>{description}</p>
    </div>
  );
}
