"use client";

import { Button, type buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { RiArrowDownSLine } from "@remixicon/react";
import type { VariantProps } from "class-variance-authority";
import type * as React from "react";

type ActionMenuButtonItem = {
  label: string;
  onSelect: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  destructive?: boolean;
};

type ActionMenuButtonProps = {
  label: string;
  icon?: React.ReactNode;
  items: ActionMenuButtonItem[];
  disabled?: boolean;
  align?: "start" | "center" | "end";
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  className?: string;
  contentClassName?: string;
};

/**
 * Labeled dropdown trigger for compact action groups.
 */
function ActionMenuButton({
  label,
  icon,
  items,
  disabled,
  align = "end",
  variant = "default",
  size = "sm",
  className,
  contentClassName,
}: ActionMenuButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={disabled || items.length === 0}
          className={cn("justify-between", className)}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {icon}
            <span className="truncate">{label}</span>
          </span>
          <RiArrowDownSLine className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={cn("min-w-44", contentClassName)}>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            disabled={item.disabled}
            variant={item.destructive ? "destructive" : "default"}
            onSelect={item.onSelect}
          >
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { ActionMenuButton, type ActionMenuButtonItem };
