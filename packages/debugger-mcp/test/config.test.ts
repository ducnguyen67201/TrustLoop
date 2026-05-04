import { describe, expect, it } from "vitest";
import { getEnvironmentStatus, getServiceConfigSnapshot } from "../src/lib/config";

describe("debugger MCP config", () => {
  it("redacts secret values while preserving useful URL host/port diagnostics", () => {
    const env = {
      NODE_ENV: "staging",
      DOPPLER_PROJECT: "trustloop",
      DOPPLER_CONFIG: "stg",
      APP_BASE_URL: "https://staging3.gettrustloop.app",
      DATABASE_URL: "postgresql://user:pass@db.example.com:5432/trustloop",
      TEMPORAL_ADDRESS: "quickstart-trustloop.tl36z.tmprl.cloud:7233",
      TEMPORAL_NAMESPACE: "quickstart-trustloop.tl36z",
      TEMPORAL_API_KEY: "secret-temporal-key",
      INTERNAL_SERVICE_KEY: "tli_secret",
      AGENT_SERVICE_URL: "http://agents.railway.internal:4000",
    };

    expect(getEnvironmentStatus(env)).toEqual({
      nodeEnv: "staging",
      dopplerProject: "trustloop",
      dopplerConfig: "stg",
      temporalAddress: "quickstart-trustloop.tl36z.tmprl.cloud:7233",
      temporalNamespace: "quickstart-trustloop.tl36z",
      temporalApiKeyPresent: true,
      agentServiceUrl: "agents.railway.internal:4000",
      appBaseUrl: "staging3.gettrustloop.app",
      databaseUrlPresent: true,
      internalServiceKeyPresent: true,
    });

    const snapshot = getServiceConfigSnapshot("queue", env);
    expect(snapshot.required).toContainEqual({
      key: "AGENT_SERVICE_URL",
      present: true,
      value: "http://agents.railway.internal:4000/",
    });
    expect(snapshot.required).toContainEqual({
      key: "DATABASE_URL",
      present: true,
      value: "<redacted>",
    });
    expect(snapshot.required).toContainEqual({
      key: "INTERNAL_SERVICE_KEY",
      present: true,
      value: "<redacted>",
    });
  });
});
