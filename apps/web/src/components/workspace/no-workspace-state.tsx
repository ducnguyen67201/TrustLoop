import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RequestAccessForm } from "@/components/workspace/request-access-form";
import { Logo } from "@shared/brand";

/**
 * Landing page for authenticated users with no workspace membership.
 *
 * The Google sign-in callback lands brand-new users here when their
 * email domain doesn't match an existing workspace (the TrustLoop AI team
 * provisions workspaces manually during customer onboarding for now).
 * Copy is intentionally warm — every prospect's first impression after
 * clicking "Continue with Google" happens on this page, so the message
 * needs to funnel them into a sales conversation rather than reading
 * as a permission error.
 */
export function NoWorkspaceState() {
  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="items-center text-center">
        <Logo title="TrustLoop AI" className="mb-3 size-12" />
        <CardTitle>Your team hasn't set up TrustLoop AI yet</CardTitle>
        <CardDescription>
          Signing in worked, but your company doesn't have a TrustLoop AI workspace yet. Drop us a
          line and we'll get your team set up.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTitle>Get in touch</AlertTitle>
          <AlertDescription>
            Email{" "}
            <a className="font-medium underline" href="mailto:hello@trustloop.com">
              hello@trustloop.com
            </a>{" "}
            and we'll get your team onboarded. Or leave a message below and we'll reach out.
          </AlertDescription>
        </Alert>

        <RequestAccessForm />
      </CardContent>
    </Card>
  );
}
