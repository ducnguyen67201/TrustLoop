"use client";

import { Button } from "@/components/ui/button";
import { RequestAccessForm } from "@/components/workspace/request-access-form";
import { Logo } from "@shared/brand";

/**
 * Landing for authenticated users with no workspace membership.
 *
 * Google sign-in lands brand-new users here when their email domain doesn't
 * match an existing workspace (TrustLoop provisions workspaces manually
 * during onboarding for now). This is a prospect's first impression after
 * clicking "Continue with Google", so the page doubles as a marketing
 * surface: left side restricts access, right side sells the product.
 *
 * Structurally mirrors /login (rounded split card on dot-grid) but with
 * differentiated content: left side is access-recovery, right side is a
 * warmer "while you wait" panel rather than the hero sell.
 */
export function NoWorkspaceState({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="w-full max-w-5xl overflow-hidden rounded-2xl border bg-card shadow-xl">
      <div className="grid md:grid-cols-[1.1fr_1fr]">
        <AccessPanel onSignOut={onSignOut} />
        <WhileYouWaitPanel />
      </div>
    </div>
  );
}

function AccessPanel({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="flex flex-col justify-center p-8 md:p-12">
      <Logo
        title="TrustLoop AI"
        className="mb-8 size-12 rounded-full bg-foreground/5 p-2.5"
      />

      <h1 className="text-3xl font-semibold tracking-tight text-balance">Access Restricted</h1>
      <p className="mt-2 text-sm text-muted-foreground text-balance">
        Sign-in worked, but you don't have access to a workspace yet. Contact your admin, or
        request access below and we'll find someone who can help.
      </p>

      <div className="mt-8">
        <RequestAccessForm />
      </div>

      <div className="mt-6 flex items-center gap-2 border-t pt-6 text-sm text-muted-foreground">
        <span>Wrong account?</span>
        <Button
          type="button"
          variant="link"
          onClick={onSignOut}
          className="h-auto p-0 font-semibold text-foreground"
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}

/**
 * Right-side panel. Structurally echoes /login's VisualSide but reframed
 * as "while you wait for access" — friendlier, onboarding-oriented, not a
 * raw sales pitch. Keeps the product metrics since they're useful context
 * for a prospect deciding whether to wait for manual provisioning.
 */
function WhileYouWaitPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-foreground md:block">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_15%,var(--primary)_0%,transparent_55%)] opacity-35" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_95%,var(--primary)_0%,transparent_60%)] opacity-20" />

      <Logo
        title="TrustLoop AI"
        className="-top-16 -left-20 absolute size-[26rem] text-background opacity-[0.05]"
      />

      <div className="relative flex h-full flex-col justify-between p-10 md:p-12 text-background">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-background/20 bg-background/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-background backdrop-blur-sm">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
          </span>
          Provisioning · Pending Access
        </div>

        <div>
          <h2 className="text-3xl font-semibold tracking-tight text-balance">
            While you wait, here's what you're getting.
          </h2>
          <p className="mt-3 text-sm text-background/70 text-pretty">
            TrustLoop reads your repo, replays the customer's session, drafts the Slack reply, and
            preps the fix PR. Every answer grounded in real code. Your admin will have you in
            shortly.
          </p>

          <dl className="mt-8 grid grid-cols-3 gap-4 border-background/15 border-t pt-6">
            <Metric value="<30s" label="First draft" />
            <Metric value="90%+" label="Accuracy" />
            <Metric value="Hours" label="Saved / wk" />
          </dl>
        </div>
      </div>
    </aside>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="text-xl font-semibold tracking-tight text-background">{value}</dt>
      <dd className="mt-1 text-[10px] font-medium uppercase tracking-wider text-background/60">
        {label}
      </dd>
    </div>
  );
}
