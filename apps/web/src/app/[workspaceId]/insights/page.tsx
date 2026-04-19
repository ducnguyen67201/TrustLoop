import { ConversationProgress } from "@/components/insights/conversation-progress";

export default function WorkspaceInsightsPage() {
  return (
    <div className="w-full p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 border-b pb-4 md:flex-row md:items-baseline md:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Insights</h1>
          <p className="text-muted-foreground text-sm">
            Conversation processing timeline and progress overview.
          </p>
        </div>
      </div>
      <ConversationProgress />
    </div>
  );
}
