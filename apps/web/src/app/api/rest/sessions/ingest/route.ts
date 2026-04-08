import {
  handleSessionIngest,
  handleSessionIngestOptions,
} from "@/server/http/rest/sessions/ingest";

export const POST = handleSessionIngest;
export const OPTIONS = handleSessionIngestOptions;
