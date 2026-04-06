import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="flex max-w-md flex-col items-center text-center">
        {/* Large 404 number */}
        <p className="font-heading text-[8rem] leading-none font-bold tracking-tighter text-primary">
          404
        </p>

        {/* Friendly message */}
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Uh-oh, seems like you got lost!
        </h1>
        <p className="mt-2 text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>

        {/* Return button */}
        <Button asChild className="mt-8" size="lg">
          <Link href="/">Return to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
