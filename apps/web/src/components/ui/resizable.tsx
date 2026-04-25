"use client";

import { cn } from "@/lib/utils";
import * as ResizablePrimitive from "react-resizable-panels";

type ResizablePanelGroupProps = Omit<ResizablePrimitive.PanelGroupProps, "direction"> & {
  direction?: ResizablePrimitive.PanelGroupProps["direction"];
  orientation?: ResizablePrimitive.PanelGroupProps["direction"];
};

function ResizablePanelGroup({
  className,
  direction,
  orientation,
  ...props
}: ResizablePanelGroupProps) {
  const resolvedDirection = orientation ?? direction;

  return (
    <ResizablePrimitive.PanelGroup
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className)}
      direction={resolvedDirection ?? "horizontal"}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.PanelResizeHandleProps & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.PanelResizeHandle
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border ring-offset-background transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 hover:bg-primary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[resize-handle-state=drag]:bg-primary data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-2 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle ? (
        <div className="z-10 flex h-6 w-1 shrink-0 items-center justify-center rounded-sm bg-border" />
      ) : null}
    </ResizablePrimitive.PanelResizeHandle>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
