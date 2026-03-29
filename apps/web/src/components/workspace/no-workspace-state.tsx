import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RequestAccessForm } from "@/components/workspace/request-access-form";

/**
 * Dedicated state for authenticated users who have no workspace memberships.
 */
export function NoWorkspaceState() {
  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle>No workspace access yet</CardTitle>
        <CardDescription>
          Your account is authenticated, but it is not currently linked to any workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTitle>Need access?</AlertTitle>
          <AlertDescription>
            Contact us with the workspace you need and we will route your request to the correct
            owner.
          </AlertDescription>
        </Alert>

        <RequestAccessForm />
      </CardContent>
    </Card>
  );
}
