import { TrustLoop } from "@trustloop/sdk";

const INGEST_URL = process.env.NEXT_PUBLIC_TRUSTLOOP_INGEST_URL ?? "http://localhost:3000";

const API_KEY =
  process.env.NEXT_PUBLIC_TRUSTLOOP_API_KEY ??
  "tlk_daab3bd45655a724dc45.aa84f54cd104b1bf76695fed136ea713ebd930f86421eee2aca0d3292b391eb6a2ef44c4ce2c63a2";

let initialized = false;

export function initSDK(): void {
  if (initialized || typeof window === "undefined") return;

  if (!API_KEY) {
    console.warn("[demo-app] NEXT_PUBLIC_TRUSTLOOP_API_KEY is not set. SDK will not send data.");
    return;
  }

  TrustLoop.init({
    apiKey: API_KEY,
    ingestUrl: INGEST_URL,
    debug: true,
    maskAllText: false,
    maskAllInputs: false,
  });

  initialized = true;
}

export function loginUser(id: string, email: string, name: string): void {
  TrustLoop.setUser({ id, email, name });
  TrustLoop.startRecording();
}

export { TrustLoop };
