import {
  handleReplayChunk,
  handleReplayChunkOptions,
} from "@/server/http/rest/sessions/replay-chunk";

export const GET = handleReplayChunk;
export const OPTIONS = handleReplayChunkOptions;
