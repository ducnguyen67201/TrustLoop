import "dotenv/config";

import { prisma } from "@shared/database";

/**
 * Parse and validate CLI arguments for workspace bootstrap.
 */
function parseArgs(argv: string[]): { workspaceName: string; email: string } {
  const [workspaceNameRaw, emailRaw] = argv;

  const workspaceName = workspaceNameRaw?.trim();
  const email = emailRaw?.trim().toLowerCase();

  if (!workspaceName || !email) {
    throw new Error("Usage: npm run db:new-workspace <workspace-name> <email>");
  }

  if (!email.includes("@")) {
    throw new Error(`Invalid email: "${emailRaw}"`);
  }

  return { workspaceName, email };
}

/**
 * Create (or reuse) a workspace and ensure the provided user is an OWNER member.
 */
async function createWorkspaceForUser(workspaceName: string, email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });

  if (!user) {
    throw new Error(
      `User "${email}" does not exist. Register first, then run this command again.`
    );
  }

  const workspace = await prisma.$transaction(async (tx) => {
    const existingWorkspace = await tx.workspace.findFirst({
      where: { name: workspaceName },
      select: { id: true, name: true },
    });

    const targetWorkspace =
      existingWorkspace ??
      (await tx.workspace.create({
        data: { name: workspaceName },
        select: { id: true, name: true },
      }));

    await tx.workspaceMembership.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: targetWorkspace.id,
          userId: user.id,
        },
      },
      update: {
        role: "OWNER",
      },
      create: {
        workspaceId: targetWorkspace.id,
        userId: user.id,
        role: "OWNER",
      },
    });

    return targetWorkspace;
  });

  console.log(`Workspace ready: ${workspace.name} (${workspace.id})`);
  console.log(`Owner member: ${user.email}`);
}

async function main(): Promise<void> {
  const { workspaceName, email } = parseArgs(process.argv.slice(2));
  await createWorkspaceForUser(workspaceName, email);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`db:new-workspace failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
