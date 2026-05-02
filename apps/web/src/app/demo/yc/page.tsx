import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RiBrainLine,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiDatabase2Line,
  RiFileTextLine,
  RiGitRepositoryLine,
  RiGithubLine,
  RiInboxLine,
  RiPlayCircleLine,
  RiRobot2Line,
  RiSearchLine,
  RiSendPlane2Line,
  RiSlackLine,
  RiSparklingLine,
} from "@remixicon/react";
import type { RemixiconComponentType } from "@remixicon/react";
import type { ReactNode } from "react";

type FloatingIssue = {
  source: string;
  text: string;
  icon: RemixiconComponentType;
  className: string;
};

type PipelineStep = {
  title: string;
  label: string;
  icon: RemixiconComponentType;
};

const floatingIssues: FloatingIssue[] = [
  {
    source: "INBOX",
    text: "SSO checkout loop",
    icon: RiInboxLine,
    className: "tl-video-float-a left-[18%] top-[14%] rotate-[-7deg]",
  },
  {
    source: "SLACK",
    text: "Manager asking for ETA",
    icon: RiSlackLine,
    className: "tl-video-float-b left-[28%] top-[25%] rotate-[-10deg]",
  },
  {
    source: "REPO",
    text: "New linked issue",
    icon: RiGithubLine,
    className: "tl-video-float-c right-[31%] top-[18%] rotate-[7deg]",
  },
  {
    source: "DOCS",
    text: "Runbook unclear",
    icon: RiFileTextLine,
    className: "tl-video-float-d left-[19%] bottom-[22%] rotate-[9deg]",
  },
  {
    source: "REPLAY",
    text: "User stuck at billing",
    icon: RiPlayCircleLine,
    className: "tl-video-float-e right-[18%] bottom-[19%] rotate-[-8deg]",
  },
  {
    source: "SLACK",
    text: "Customer asks again",
    icon: RiSlackLine,
    className: "tl-video-float-f left-[43%] bottom-[13%] rotate-[4deg]",
  },
  {
    source: "GITHUB",
    text: "PR blocked: needs context",
    icon: RiGithubLine,
    className: "tl-video-float-g right-[13%] top-[36%] rotate-[-11deg]",
  },
  {
    source: "ALERT",
    text: "Renewal at risk",
    icon: RiSparklingLine,
    className: "tl-video-float-h left-[38%] top-[10%] rotate-[5deg]",
  },
];

const pipelineSteps: PipelineStep[] = [
  { title: "Issue", label: "Customer asks for help", icon: RiSlackLine },
  { title: "Company Brain", label: "Repo, docs, tickets, replay", icon: RiBrainLine },
  { title: "Approved Reply", label: "Evidence-backed response", icon: RiSendPlane2Line },
];

const evidenceRows = [
  {
    icon: RiGitRepositoryLine,
    title: "Repo: checkout/sso-gate.ts",
    detail: "Org scope fallback changed in yesterday's deploy.",
  },
  {
    icon: RiFileTextLine,
    title: "Docs: Enterprise SSO rollout",
    detail: "Checkout requires org-scoped auth before plan activation.",
  },
  {
    icon: RiPlayCircleLine,
    title: "Replay: 03:18 checkout loop",
    detail: "User returns to billing after SSO completes.",
  },
];

export const metadata = {
  title: "TrustLoop YC Demo",
  description: "Recordable TrustLoop demo flow for YC-style video.",
};

export default function YcDemoPage() {
  return (
    <main className="relative h-svh overflow-hidden bg-white font-sans text-slate-950">
      <IntroScene />
      <TypingScene />
      <PipelineScene />
      <BoardScene />
      <InvestigationScene />
      <FinalScene />
    </main>
  );
}

function IntroScene() {
  return (
    <section className="tl-video-scene tl-video-scene-1 flex items-center justify-center bg-[radial-gradient(circle_at_20%_15%,rgba(255,214,224,0.82),transparent_30%),radial-gradient(circle_at_80%_22%,rgba(255,224,188,0.86),transparent_28%),linear-gradient(135deg,#fff6f8_0%,#fff2ec_48%,#fff8ee_100%)]">
      <div className="absolute inset-0">
        {floatingIssues.map((issue) => (
          <FloatingIssueCard key={`${issue.source}-${issue.text}`} issue={issue} />
        ))}
      </div>

      <div className="relative z-10 mx-auto max-w-4xl px-8 text-center">
        <Badge className="mb-5 rounded-full border-rose-200 bg-rose-50 px-4 py-1 text-rose-700">
          20 issues waiting for attention
        </Badge>
        <h1 className="text-balance text-6xl font-semibold leading-[1.02] tracking-normal text-slate-950 md:text-7xl">
          Customer issues pile up faster than your team can respond.
        </h1>
      </div>
    </section>
  );
}

function FloatingIssueCard({ issue }: { issue: FloatingIssue }) {
  return (
    <div
      className={`absolute w-56 rounded-xl border border-white/80 bg-white/90 px-4 py-3 shadow-[0_18px_48px_rgba(15,23,42,0.14)] backdrop-blur-md ${issue.className}`}
    >
      <div className="flex items-center gap-2 text-[0.65rem] font-semibold text-slate-400">
        <issue.icon className="size-3.5 text-indigo-500" aria-hidden="true" />
        {issue.source}
      </div>
      <p className="mt-1 text-sm font-semibold text-slate-800">{issue.text}</p>
    </div>
  );
}

function TypingScene() {
  return (
    <section className="tl-video-scene tl-video-scene-2 flex items-center justify-center bg-white">
      <div className="tl-video-type text-center font-mono text-5xl font-medium tracking-normal text-slate-950 md:text-6xl">
        Manual triage does not scale.
      </div>
    </section>
  );
}

function PipelineScene() {
  return (
    <section className="tl-video-scene tl-video-scene-3 flex flex-col items-center justify-center bg-white bg-[linear-gradient(rgba(15,23,42,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.035)_1px,transparent_1px)] bg-[size:64px_64px] px-8">
      <h2 className="mb-24 max-w-6xl text-center text-5xl font-semibold leading-tight tracking-normal text-slate-950 md:text-6xl">
        Resolve every customer issue with the company brain.
      </h2>

      <div className="flex w-full max-w-5xl items-center justify-center gap-12">
        {pipelineSteps.map((step, index) => (
          <PipelineNode
            key={step.title}
            step={step}
            showConnector={index < pipelineSteps.length - 1}
          />
        ))}
      </div>
    </section>
  );
}

function PipelineNode({
  step,
  showConnector,
}: {
  step: PipelineStep;
  showConnector: boolean;
}) {
  return (
    <>
      <div className="flex flex-col items-center text-center">
        <div className="flex size-24 items-center justify-center rounded-full border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.12)]">
          <step.icon className="size-9 text-slate-950" aria-hidden="true" />
        </div>
        <p className="mt-5 text-2xl font-semibold">{step.title}</p>
        <p className="mt-2 text-sm text-slate-500">{step.label}</p>
      </div>
      {showConnector ? (
        <div className="h-1 w-44 overflow-hidden rounded-full bg-slate-200">
          <div className="tl-video-line h-full rounded-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400" />
        </div>
      ) : null}
    </>
  );
}

function BoardScene() {
  return (
    <section className="tl-video-scene tl-video-scene-4 flex items-center justify-center bg-[radial-gradient(circle_at_12%_18%,#d9f0ff_0%,transparent_34%),radial-gradient(circle_at_84%_12%,#dbeafe_0%,transparent_32%),linear-gradient(135deg,#7db7dd_0%,#eef7ff_44%,#2f6fc7_100%)] p-14">
      <DesktopWindow>
        <IssueBoard />
      </DesktopWindow>
      <Caption>Every issue is investigated automatically.</Caption>
    </section>
  );
}

function InvestigationScene() {
  return (
    <section className="tl-video-scene tl-video-scene-5 flex items-center justify-center bg-[radial-gradient(circle_at_12%_18%,#d9f0ff_0%,transparent_34%),radial-gradient(circle_at_84%_12%,#dbeafe_0%,transparent_32%),linear-gradient(135deg,#7db7dd_0%,#eef7ff_44%,#2f6fc7_100%)] p-14">
      <DesktopWindow>
        <InvestigationView />
      </DesktopWindow>
      <Caption>It pulls context from tickets, docs, repos, and sessions.</Caption>
    </section>
  );
}

function FinalScene() {
  return (
    <section className="tl-video-scene tl-video-scene-6 flex items-center justify-center bg-[radial-gradient(circle_at_12%_18%,#d9f0ff_0%,transparent_34%),radial-gradient(circle_at_84%_12%,#dbeafe_0%,transparent_32%),linear-gradient(135deg,#7db7dd_0%,#eef7ff_44%,#2f6fc7_100%)] p-14">
      <div className="h-[82vh] w-[86vw] overflow-hidden rounded-2xl bg-slate-950 shadow-[0_42px_110px_rgba(2,6,23,0.44)] ring-1 ring-white/30">
        <div className="border-b border-white/10 px-8 py-5">
          <Badge className="rounded-full bg-slate-800 px-3 py-1 text-slate-100">Draft</Badge>
          <h2 className="mt-4 max-w-5xl text-lg font-semibold text-slate-100">
            ACME checkout SSO loop resolved with evidence, response, and saved memory.
          </h2>
        </div>
        <div className="grid h-full grid-cols-[1fr_21rem] gap-8 p-8">
          <div className="space-y-6 text-slate-200">
            <DarkPanel title="Customer reply">
              We found the SSO checkout loop and are rolling back the org-scope fallback. Your
              renewal path should be unblocked shortly.
            </DarkPanel>
            <DarkPanel title="Evidence">
              Repo path, past ticket, docs, replay, and Slack note attached for review.
            </DarkPanel>
            <DarkPanel title="Company memory">
              Resolution saved so the next similar issue starts with this context.
            </DarkPanel>
          </div>
          <aside className="space-y-4 border-l border-white/10 pl-8 text-sm text-slate-400">
            <p className="font-semibold text-slate-100">Review checklist</p>
            <CheckRow label="Root cause confirmed" />
            <CheckRow label="Reply approved" />
            <CheckRow label="Memory updated" />
          </aside>
        </div>
      </div>
      <Caption>Your team reviews the answer and closes the loop.</Caption>
    </section>
  );
}

function DesktopWindow({ children }: { children: ReactNode }) {
  return (
    <div className="h-[82vh] w-[86vw] overflow-hidden rounded-2xl bg-white shadow-[0_42px_110px_rgba(15,23,42,0.28)] ring-1 ring-white/70">
      {children}
    </div>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return (
    <div className="absolute bottom-12 left-1/2 z-20 -translate-x-1/2 rounded-full bg-slate-700/90 px-9 py-4 text-3xl font-semibold text-white shadow-2xl backdrop-blur">
      {children}
    </div>
  );
}

function IssueBoard() {
  return (
    <div className="grid h-full grid-cols-[14rem_1fr] bg-slate-50">
      <Sidebar />
      <div className="p-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Issues</h2>
            <p className="mt-1 text-sm text-slate-500">
              Track and manage prioritized customer issues.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              Board
            </Button>
            <Button variant="outline" size="sm">
              Active
            </Button>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-4 gap-5">
          <IssueColumn title="Issues" count="4">
            <IssueCard
              status="Working"
              title="ACME Corp"
              body="Enterprise SSO checkout loop blocks renewal."
            />
          </IssueColumn>
          <IssueColumn title="Waiting" count="1">
            <IssueCard
              status="Ready"
              title="Northstar Health"
              body="Evidence collected from docs and replay."
            />
          </IssueColumn>
          <IssueColumn title="Fix bug" count="1">
            <IssueCard
              status="Ready"
              title="ACME Billing"
              body="Draft response waiting for approval."
            />
          </IssueColumn>
          <IssueColumn title="Product gaps" count="4">
            <IssueCard
              status="Ready"
              title="UseSilence"
              body="Slack attachments dropped from investigation."
            />
            <IssueCard
              status="Ready"
              title="UseSilence"
              body="Custom tool validates fixture like internal ID."
            />
          </IssueColumn>
        </div>
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="flex flex-col border-r border-slate-200 bg-white/80 p-6">
      <div className="flex items-center gap-3 text-xl font-semibold">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm text-primary-foreground">
          TL
        </span>
        TrustLoop
      </div>
      <div className="mt-14 text-xs font-semibold uppercase text-slate-400">Menu</div>
      <div className="mt-3 flex items-center gap-3 rounded-xl bg-slate-100 px-3 py-3 text-sm font-semibold">
        <RiSearchLine className="size-4" aria-hidden="true" />
        Issues
      </div>
      <div className="mt-2 flex items-center gap-3 px-3 py-3 text-sm font-semibold text-slate-500">
        <RiRobot2Line className="size-4" aria-hidden="true" />
        Agents
      </div>
      <div className="mt-auto border-t border-slate-200 pt-5 text-xs text-slate-500">
        Company brain live
      </div>
    </aside>
  );
}

function IssueColumn({
  title,
  count,
  children,
}: {
  title: string;
  count: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {title}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
          {count}
        </span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function IssueCard({ status, title, body }: { status: string; title: string; body: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
          {status}
        </span>
        <span className="text-slate-400">P2</span>
      </div>
      <p className="font-semibold">{title}</p>
      <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-500">{body}</p>
    </article>
  );
}

function InvestigationView() {
  return (
    <div className="grid h-full grid-cols-[14rem_1fr_21rem] bg-white">
      <Sidebar />
      <section className="overflow-hidden p-8">
        <div className="flex items-start justify-between border-b border-slate-200 pb-5">
          <div>
            <h2 className="text-2xl font-semibold">ACME Corp</h2>
            <div className="mt-3 flex gap-2">
              <Badge className="rounded-full bg-blue-100 text-blue-700">P2</Badge>
              <Badge className="rounded-full bg-emerald-100 text-emerald-700">Resolved</Badge>
              <Badge variant="outline" className="rounded-full">
                Checkout
              </Badge>
            </div>
          </div>
          <Button size="sm">
            <RiSendPlane2Line className="size-4" aria-hidden="true" />
            Approve reply
          </Button>
        </div>

        <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50/60 p-5">
          <p className="text-sm font-semibold">What TrustLoop found</p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
            <li>Enterprise checkout loses org scope after SSO authentication.</li>
            <li>Yesterday's deploy changed the fallback in `checkout/sso-gate.ts`.</li>
            <li>ACME's replay confirms the loop before plan activation.</li>
          </ul>
        </div>

        <div className="mt-6">
          <p className="mb-3 text-sm font-semibold">Evidence</p>
          <div className="space-y-3">
            {evidenceRows.map((row) => (
              <EvidenceRow key={row.title} row={row} />
            ))}
          </div>
        </div>
      </section>

      <aside className="border-l border-slate-200 bg-slate-50 p-8">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase text-slate-400">Conversation</p>
          <RiCloseLine className="size-4 text-slate-400" aria-hidden="true" />
        </div>
        <p className="mt-8 text-sm leading-7 text-slate-600">
          Enterprise users are stuck after SSO. Checkout returns them to billing and our renewal is
          blocked. Can you help us understand what changed?
        </p>
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold">Draft reply</p>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            We found the checkout loop and are rolling back the org-scope fallback. Evidence is
            attached.
          </p>
        </div>
      </aside>
    </div>
  );
}

function EvidenceRow({
  row,
}: {
  row: {
    icon: RemixiconComponentType;
    title: string;
    detail: string;
  };
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <span className="flex size-10 items-center justify-center rounded-lg bg-slate-100">
        <row.icon className="size-5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-semibold">{row.title}</p>
        <p className="text-sm text-slate-500">{row.detail}</p>
      </div>
      <Button variant="outline" size="sm" className="ml-auto">
        Open
      </Button>
    </div>
  );
}

function DarkPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-sm font-semibold text-slate-100">{title}</p>
      <p className="mt-3 text-sm leading-6 text-slate-400">{children}</p>
    </section>
  );
}

function CheckRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <RiCheckboxCircleLine className="size-5 text-emerald-400" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
