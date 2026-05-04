import { z } from "zod";
import { getUrlHostPort, redactValue } from "./redaction";

export const SERVICE_NAMES = {
  web: "web",
  queue: "queue",
  agents: "agents",
  marketing: "marketing",
} as const;

export const serviceNameSchema = z.enum([
  SERVICE_NAMES.web,
  SERVICE_NAMES.queue,
  SERVICE_NAMES.agents,
  SERVICE_NAMES.marketing,
]);

export type ServiceName = z.infer<typeof serviceNameSchema>;

export interface DebuggerEnvironment {
  nodeEnv: string | null;
  dopplerProject: string | null;
  dopplerConfig: string | null;
  temporalAddress: string | null;
  temporalNamespace: string | null;
  temporalApiKeyPresent: boolean;
  agentServiceUrl: string | null;
  appBaseUrl: string | null;
  databaseUrlPresent: boolean;
  internalServiceKeyPresent: boolean;
}

export interface ServiceConfigSnapshot {
  service: ServiceName;
  required: Array<{
    key: string;
    present: boolean;
    value: string | null;
  }>;
  optional: Array<{
    key: string;
    present: boolean;
    value: string | null;
  }>;
}

export interface TemporalConnectionConfig {
  address: string;
  namespace: string;
  apiKey: string | null;
}

const COMMON_REQUIRED_KEYS = [
  "NODE_ENV",
  "APP_BASE_URL",
  "DATABASE_URL",
  "TEMPORAL_ADDRESS",
  "TEMPORAL_NAMESPACE",
] as const;

const SERVICE_REQUIRED_KEYS: Record<ServiceName, readonly string[]> = {
  web: [...COMMON_REQUIRED_KEYS, "INTERNAL_SERVICE_KEY"],
  queue: [...COMMON_REQUIRED_KEYS, "INTERNAL_SERVICE_KEY", "AGENT_SERVICE_URL"],
  agents: [...COMMON_REQUIRED_KEYS, "INTERNAL_SERVICE_KEY"],
  marketing: ["NODE_ENV"],
};

const SERVICE_OPTIONAL_KEYS: Record<ServiceName, readonly string[]> = {
  web: ["APP_PUBLIC_URL", "SLACK_SIGNING_SECRET", "AGENT_SERVICE_URL"],
  queue: ["TEMPORAL_API_KEY", "SLACK_BOT_TOKEN", "GITHUB_APP_PRIVATE_KEY"],
  agents: ["TEMPORAL_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"],
  marketing: ["APP_PUBLIC_URL"],
};

export function getEnvironmentStatus(source: NodeJS.ProcessEnv = process.env): DebuggerEnvironment {
  return {
    nodeEnv: source.NODE_ENV ?? null,
    dopplerProject: source.DOPPLER_PROJECT ?? null,
    dopplerConfig: source.DOPPLER_CONFIG ?? source.DOPPLER_ENVIRONMENT ?? null,
    temporalAddress: getUrlLikeHostPort(source.TEMPORAL_ADDRESS),
    temporalNamespace: source.TEMPORAL_NAMESPACE ?? null,
    temporalApiKeyPresent: Boolean(source.TEMPORAL_API_KEY),
    agentServiceUrl: getUrlHostPort(source.AGENT_SERVICE_URL),
    appBaseUrl: getUrlHostPort(source.APP_BASE_URL),
    databaseUrlPresent: Boolean(source.DATABASE_URL),
    internalServiceKeyPresent: Boolean(source.INTERNAL_SERVICE_KEY),
  };
}

export function getTemporalConnectionConfig(
  source: NodeJS.ProcessEnv = process.env
): TemporalConnectionConfig {
  const address = source.TEMPORAL_ADDRESS;
  const namespace = source.TEMPORAL_NAMESPACE;

  if (!address) {
    throw new Error("Missing TEMPORAL_ADDRESS. Run the MCP server through `doppler run -- ...`.");
  }

  if (!namespace) {
    throw new Error("Missing TEMPORAL_NAMESPACE. Run the MCP server through `doppler run -- ...`.");
  }

  return {
    address,
    namespace,
    apiKey: source.TEMPORAL_API_KEY ?? null,
  };
}

export function getServiceConfigSnapshot(
  service: ServiceName,
  source: NodeJS.ProcessEnv = process.env
): ServiceConfigSnapshot {
  return {
    service,
    required: SERVICE_REQUIRED_KEYS[service].map((key) => summarizeEnvKey(key, source)),
    optional: SERVICE_OPTIONAL_KEYS[service].map((key) => summarizeEnvKey(key, source)),
  };
}

function summarizeEnvKey(
  key: string,
  source: NodeJS.ProcessEnv
): { key: string; present: boolean; value: string | null } {
  const value = source[key];
  return {
    key,
    present: Boolean(value),
    value: redactValue(key, value),
  };
}

function getUrlLikeHostPort(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.includes("://")) return value;
  return getUrlHostPort(value);
}
