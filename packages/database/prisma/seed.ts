import "dotenv/config";

import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const PASSWORD_HASH_OPTIONS = {
  algorithm: 2 as const,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/trustloop?schema=public";

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SEED_USER_EMAIL = "duc@gmail.com";
const SEED_USER_PASSWORD = "test1234";
const WORKSPACE_ID = "workspace_default";
const WORKSPACE_NAME = "Default Workspace";

/* ------------------------------------------------------------------ */
/*  Seed logic — designed for fresh DB after `prisma migrate reset`    */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("Seeding database...\n");

  // 1. User (manual upsert — Prisma upsert fails with partial unique indexes)
  const passwordHash = await hash(SEED_USER_PASSWORD, PASSWORD_HASH_OPTIONS);
  const existingUser = await prisma.user.findFirst({
    where: { email: SEED_USER_EMAIL, deletedAt: null },
  });
  const user = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data: { passwordHash },
      })
    : await prisma.user.create({
        data: { email: SEED_USER_EMAIL, passwordHash },
      });
  console.log(`User: ${user.email} (${user.id})`);

  // 2. Workspace
  const workspace = await prisma.workspace.upsert({
    where: { id: WORKSPACE_ID },
    update: {},
    create: {
      id: WORKSPACE_ID,
      name: WORKSPACE_NAME,
    },
  });
  console.log(`Workspace: ${workspace.name} (${workspace.id})`);

  // 3. Membership (OWNER) — manual upsert for partial unique index
  const existingMembership = await prisma.workspaceMembership.findFirst({
    where: { workspaceId: workspace.id, userId: user.id, deletedAt: null },
  });
  if (!existingMembership) {
    await prisma.workspaceMembership.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: "OWNER",
      },
    });
  }
  console.log(`Membership: ${user.email} → OWNER of ${workspace.name}`);

  // 4. GitHub Installation
  await prisma.gitHubInstallation.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      status: "connected",
      installationOwner: "ducnguyen67201",
      missingPermissions: [],
    },
  });
  console.log("GitHub Installation: ducnguyen67201 (connected)");

  // 5. Repository (TrustLoop monorepo)
  const repo = await prisma.repository.upsert({
    where: {
      workspaceId_fullName: {
        workspaceId: workspace.id,
        fullName: "ducnguyen67201/TrustLoop",
      },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      owner: "ducnguyen67201",
      name: "TrustLoop",
      fullName: "ducnguyen67201/TrustLoop",
      sourceRoot: ".",
      defaultBranch: "main",
      branchPolicy: "default_branch_only",
      selected: true,
    },
  });
  console.log(`Repository: ${repo.fullName} (selected: true)`);

  // 5b. Repository Index Version (stub so analysis passes the "indexed repo" check)
  const existingIndex = await prisma.repositoryIndexVersion.findFirst({
    where: { workspaceId: workspace.id, repositoryId: repo.id, status: "active" },
  });
  if (!existingIndex) {
    await prisma.repositoryIndexVersion.create({
      data: {
        workspaceId: workspace.id,
        repositoryId: repo.id,
        status: "active",
        active: true,
        commitSha: "seed-placeholder",
        completedAt: new Date(),
        activatedAt: new Date(),
        fileCount: 1,
        chunkCount: 1,
      },
    });
  }
  console.log("Index Version: active (stub for analysis)");

  // 6. Slack Support Installation (stub for local dev)
  const existingSlack = await prisma.supportInstallation.findFirst({
    where: { workspaceId: workspace.id, provider: "SLACK", deletedAt: null },
  });
  // The bot echo filter in runSupportPipeline compares inbound Slack events
  // against installation.botUserId to distinguish our own chat.postMessage
  // echoes from messages authored by other bots. If you're dev-testing
  // against a real Slack workspace, set SLACK_DEV_BOT_USER_ID in .env to
  // the bot user ID your workspace actually uses (visible in DELIVERY_*
  // log lines or on Slack's app admin page). The fallback placeholder only
  // works for synthetic / no-real-Slack dev because it won't match any
  // real event's user field.
  const seedBotUserId = process.env.SLACK_DEV_BOT_USER_ID ?? "U0BOTLOCAL";
  const slackInstallation =
    existingSlack ??
    (await prisma.supportInstallation.create({
      data: {
        workspaceId: workspace.id,
        provider: "SLACK",
        providerInstallationId: "local-dev-slack",
        teamId: "T0AQB0129QD",
        botUserId: seedBotUserId,
        metadata: {
          groupingWindowMinutes: 5,
          maxGroupingWindowMinutes: 60,
        },
      },
    }));
  console.log(`Slack Installation: ${slackInstallation.teamId} (${slackInstallation.id})`);

  // 7. Workspace AI Settings (default tone)
  await prisma.workspaceAiSettings.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      defaultTone: "professional",
      maxDraftLength: 500,
      includeCodeRefs: true,
    },
  });
  console.log("AI Settings: professional tone, 500 char max");

  // 8. Sample support conversation (for testing analysis)
  const existingConvo = await prisma.supportConversation.findFirst({
    where: { workspaceId: workspace.id, channelId: "C0TEST001", threadTs: "1712345678.000100" },
  });
  const conversation =
    existingConvo ??
    (await prisma.supportConversation.create({
      data: {
        workspaceId: workspace.id,
        installationId: slackInstallation.id,
        canonicalConversationKey: "T0AQB0129QD:C0TEST001:1712345678.000100",
        teamId: "T0AQB0129QD",
        channelId: "C0TEST001",
        threadTs: "1712345678.000100",
        status: "UNREAD",
        lastCustomerMessageAt: new Date(),
      },
    }));
  console.log(`Conversation: ${conversation.id} (${existingConvo ? "existing" : "UNREAD"})`);

  // 9. Sample conversation events (only seed if conversation is new)
  if (!existingConvo) {
    await prisma.supportConversationEvent.createMany({
      data: [
        {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          eventType: "MESSAGE_RECEIVED",
          eventSource: "CUSTOMER",
          summary:
            "Getting a 500 error when I try to connect my GitHub repo. The page just shows 'Internal Server Error' after I authorize.",
          detailsJson: {
            slackUserId: "U0CUSTOMER1",
            slackUsername: "alice.dev",
            customerEmail: "alice@example.com",
          },
        },
        {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          eventType: "MESSAGE_RECEIVED",
          eventSource: "CUSTOMER",
          summary:
            "I tried with a different browser and got the same error. The URL shows /api/github/callback with a code parameter but then redirects to an error page.",
          detailsJson: {
            slackUserId: "U0CUSTOMER1",
            slackUsername: "alice.dev",
            customerEmail: "alice@example.com",
          },
        },
      ],
    });
    console.log("Conversation events: 2 customer messages seeded");
  }

  console.log("\nSeed complete.");
  console.log(`\nLogin: ${SEED_USER_EMAIL} / ${SEED_USER_PASSWORD}`);
  console.log(`Conversation ID: ${conversation.id} (ready for analysis)`);
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
