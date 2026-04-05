"use client";

import { Badge } from "@/components/ui/badge";

interface ConfidenceBadgeProps {
  confidence: number;
}

function getConfidenceLevel(confidence: number) {
  if (confidence > 0.7) return { label: "High confidence", variant: "high" as const };
  if (confidence > 0.4) return { label: "Review carefully", variant: "medium" as const };
  return { label: "Needs attention", variant: "low" as const };
}

const variantStyles = {
  high: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-red-50 text-red-700 border-red-200",
};

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  const { label, variant } = getConfidenceLevel(confidence);

  return (
    <Badge
      variant="outline"
      className={variantStyles[variant]}
      aria-label={`${label}: ${Math.round(confidence * 100)}% confidence`}
    >
      {label}
    </Badge>
  );
}
