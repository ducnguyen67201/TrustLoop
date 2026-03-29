export async function createTRPCContext() {
  return {};
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;
