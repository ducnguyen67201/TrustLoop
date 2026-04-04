import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type FlashTone = "success" | "error";

/**
 * Surface post-action feedback without adding a client-side toast system to the first implementation.
 */
export function FlashBanner({
  message,
  tone,
}: {
  message: string | null;
  tone: FlashTone;
}) {
  if (!message) {
    return null;
  }

  return (
    <Alert className={tone === "error" ? "border-destructive/40 text-destructive" : ""}>
      <AlertTitle>{tone === "error" ? "Action blocked" : "Updated"}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
