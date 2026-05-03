"use client";

import { Button } from "@/components/ui/button";
import { RiCheckLine, RiEyeLine, RiEyeOffLine, RiFileCopyLine } from "@remixicon/react";
import { useState } from "react";

interface ApiKeyPrefixDisplayProps {
  keyPrefix: string;
}

interface ApiKeyOneTimeSecretDisplayProps {
  secret: string;
  onCopyError: (message: string) => void;
}

/**
 * Prefix-only display for persisted API key rows.
 */
export function ApiKeyPrefixDisplay({ keyPrefix }: ApiKeyPrefixDisplayProps) {
  const [prefixCopied, setPrefixCopied] = useState(false);

  async function handleCopyPrefix(): Promise<void> {
    try {
      await navigator.clipboard.writeText(keyPrefix);
      setPrefixCopied(true);
      window.setTimeout(() => setPrefixCopied(false), 2000);
    } catch {
      // Prefix copy is a convenience; the full secret remains one-time only.
    }
  }

  return (
    <div className="flex items-center gap-2">
      <code className="text-xs">{keyPrefix}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => void handleCopyPrefix()}
        aria-label="Copy key prefix"
        title="Copy key prefix"
      >
        {prefixCopied ? <RiCheckLine /> : <RiFileCopyLine />}
      </Button>
    </div>
  );
}

/**
 * One-time full secret display for newly-created API keys.
 */
export function ApiKeyOneTimeSecretDisplay({
  secret,
  onCopyError,
}: ApiKeyOneTimeSecretDisplayProps) {
  const [isSecretVisible, setIsSecretVisible] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);

  async function handleCopySecret(): Promise<void> {
    try {
      await navigator.clipboard.writeText(secret);
      setSecretCopied(true);
      window.setTimeout(() => setSecretCopied(false), 2000);
    } catch {
      onCopyError("Failed to copy API key secret");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <code className="bg-muted block flex-1 overflow-x-auto rounded p-2 text-xs">
          {isSecretVisible ? secret : "•".repeat(Math.min(64, secret.length))}
        </code>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => setIsSecretVisible((value) => !value)}
          aria-label={isSecretVisible ? "Hide secret" : "Show secret"}
          title={isSecretVisible ? "Hide secret" : "Show secret"}
        >
          {isSecretVisible ? <RiEyeOffLine /> : <RiEyeLine />}
        </Button>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => void handleCopySecret()}>
        {secretCopied ? <RiCheckLine /> : <RiFileCopyLine />}
        {secretCopied ? "Copied" : "Copy full secret"}
      </Button>
    </div>
  );
}
