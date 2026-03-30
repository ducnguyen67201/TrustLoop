import type { ReactNode } from "react";

type LegacyAppLayoutProps = {
  children: ReactNode;
};

/**
 * Legacy /app layout kept as a pass-through while canonical routes are workspace scoped.
 */
export default function LegacyAppLayout({ children }: LegacyAppLayoutProps) {
  return children;
}
