import { getWorkspaceBillingInfo, listActivePlans } from "@shared/rest/billing/billing-service";
import { publicProcedure, router, workspaceRoleProcedure } from "@shared/rest/trpc";
import { WORKSPACE_ROLE } from "@shared/types";
import { TRPCError } from "@trpc/server";

export const billingRouter = router({
  getWorkspacePlan: workspaceRoleProcedure(WORKSPACE_ROLE.MEMBER).query(async ({ ctx }) => {
    const info = await getWorkspaceBillingInfo(ctx.workspaceId);
    if (!info) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No billing plan found" });
    }
    return info;
  }),

  listPlans: publicProcedure.query(async () => {
    const plans = await listActivePlans();
    return { plans };
  }),
});
