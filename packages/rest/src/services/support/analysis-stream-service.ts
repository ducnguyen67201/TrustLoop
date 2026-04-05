import { prisma } from "@shared/database";
import {
  ANALYSIS_RESULT_STATUS,
  ANALYSIS_STREAM_EVENT_TYPE,
  type AnalysisStreamEventType,
} from "@shared/types/support/support-analysis.schema";

const ANALYSIS_STREAM_CHANNEL = "analysis_stream";

export interface AnalysisStreamEvent {
  analysisId: string;
  type: AnalysisStreamEventType;
  data: Record<string, unknown>;
  timestamp: string;
}

/**
 * Emit an analysis event via Postgres NOTIFY.
 * The web server subscribes to these events and pipes them to SSE clients.
 */
export async function emitAnalysisEvent(event: AnalysisStreamEvent): Promise<void> {
  const payload = JSON.stringify(event);
  await prisma.$executeRawUnsafe(
    `NOTIFY ${ANALYSIS_STREAM_CHANNEL}, '${payload.replace(/'/g, "''")}'`
  );
}

/**
 * Subscribe to analysis events for a specific analysisId via Postgres LISTEN.
 * Returns an async generator that yields events as they arrive.
 *
 * Usage in SSE endpoint:
 *   for await (const event of listenAnalysisEvents(analysisId, signal)) {
 *     controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
 *   }
 */
export async function* listenAnalysisEvents(
  analysisId: string,
  signal?: AbortSignal
): AsyncGenerator<AnalysisStreamEvent> {
  // Use a raw connection for LISTEN (Prisma doesn't support LISTEN natively).
  // For MVP, we poll the analysis record instead of true LISTEN/NOTIFY
  // because Prisma's connection pool doesn't expose raw PG connections for LISTEN.
  //
  // This polling approach checks every 500ms for new evidence rows and status changes.
  // Good enough for MVP (~500ms latency). Replace with true PG LISTEN when we add Redis.

  let lastEvidenceCount = 0;
  let lastStatus = "ANALYZING";

  while (!signal?.aborted) {
    const analysis = await prisma.supportAnalysis.findUnique({
      where: { id: analysisId },
      select: {
        status: true,
        toolCallCount: true,
        reasoningTrace: true,
        _count: { select: { evidence: true } },
      },
    });

    if (!analysis) break;

    const currentEvidenceCount = analysis._count.evidence;

    // Emit new evidence events
    if (currentEvidenceCount > lastEvidenceCount) {
      const newEvidence = await prisma.analysisEvidence.findMany({
        where: { analysisId },
        orderBy: { createdAt: "asc" },
        skip: lastEvidenceCount,
      });

      for (const evidence of newEvidence) {
        yield {
          analysisId,
          type: ANALYSIS_STREAM_EVENT_TYPE.toolResult,
          data: {
            filePath: evidence.filePath,
            snippet: evidence.snippet?.slice(0, 200),
            citation: evidence.citation,
            sourceType: evidence.sourceType,
          },
          timestamp: evidence.createdAt.toISOString(),
        };
      }
      lastEvidenceCount = currentEvidenceCount;
    }

    // Emit status change events
    if (analysis.status !== lastStatus) {
      if (analysis.status === ANALYSIS_RESULT_STATUS.analyzed || analysis.status === ANALYSIS_RESULT_STATUS.needsContext) {
        yield {
          analysisId,
          type: ANALYSIS_STREAM_EVENT_TYPE.complete,
          data: { status: analysis.status, toolCallCount: analysis.toolCallCount },
          timestamp: new Date().toISOString(),
        };
        return; // Stream complete
      }
      if (analysis.status === ANALYSIS_RESULT_STATUS.failed) {
        yield {
          analysisId,
          type: ANALYSIS_STREAM_EVENT_TYPE.error,
          data: { status: ANALYSIS_RESULT_STATUS.failed },
          timestamp: new Date().toISOString(),
        };
        return;
      }
      lastStatus = analysis.status;
    }

    // Poll interval
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
