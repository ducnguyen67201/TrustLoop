// Product metrics shown on marketing-adjacent surfaces (login split card,
// no-workspace split card, future prospect pages). Kept in one place so the
// values and the visual treatment stay in lockstep — a stat change or a
// typography tweak lands once instead of being copy-pasted across pages.
//
// Designed against the dark `bg-foreground` visual panel background: the
// typography uses `text-background` and `text-background/60` which invert
// correctly wherever this grid is dropped.

export const PRODUCT_METRICS = [
  { value: "<30s", label: "First draft" },
  { value: "90%+", label: "Accuracy" },
  { value: "Hours", label: "Saved / wk" },
] as const;

export function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="text-xl font-semibold tracking-tight text-background">{value}</dt>
      <dd className="mt-1 text-[10px] font-medium uppercase tracking-wider text-background/60">
        {label}
      </dd>
    </div>
  );
}

export function ProductMetricsGrid() {
  return (
    <dl className="mt-8 grid grid-cols-3 gap-4 border-background/15 border-t pt-6">
      {PRODUCT_METRICS.map((metric) => (
        <Metric key={metric.label} value={metric.value} label={metric.label} />
      ))}
    </dl>
  );
}
