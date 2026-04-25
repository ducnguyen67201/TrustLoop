export function parseJsonModelOutput(rawOutput: string, errorPrefix: string): unknown {
  const jsonText = normalizeJsonModelOutput(rawOutput);
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error(`${errorPrefix}: ${rawOutput.slice(0, 200)}`);
  }
}

export function normalizeJsonModelOutput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const payloadStart = trimmed.indexOf("\n");
  if (payloadStart === -1) {
    return trimmed;
  }

  const openingFence = trimmed.slice(0, payloadStart).trim();
  if (!/^```[A-Za-z0-9_-]*$/.test(openingFence)) {
    return trimmed;
  }

  const closingFence = trimmed.lastIndexOf("```");
  if (closingFence <= payloadStart) {
    return trimmed;
  }

  if (trimmed.slice(closingFence).trim() !== "```") {
    return trimmed;
  }

  const beforeClosingFence = trimmed[closingFence - 1];
  if (beforeClosingFence !== "\n" && beforeClosingFence !== "\r") {
    return trimmed;
  }

  return trimmed.slice(payloadStart + 1, closingFence).trim();
}
