import { appRouter, createTRPCContext } from "@shared/rest";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

export const trpcHandler = (request: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: createTRPCContext,
  });
