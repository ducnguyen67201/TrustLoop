import type { TRPCContext } from "@shared/rest/context";
import { initTRPC } from "@trpc/server";

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
