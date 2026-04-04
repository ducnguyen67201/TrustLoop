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

type SplitButtonMenuItem = {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  destructive?: boolean;
};

type SplitButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  menuItems?: SplitButtonMenuItem[];
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  className?: string;
};

/**
 * Split button with a primary action and a dropdown chevron for secondary actions.
 * Used for CTAs that have a default action plus alternatives.
 */
function SplitButton({
  children,
  onClick,
  disabled,
  menuItems = [],
  variant = "default",
  size = "default",
  className,
}: SplitButtonProps) {
  return (
    <div className={cn("inline-flex", className)}>
      <Button variant={variant} size={size} onClick={onClick} disabled={disabled}>
        {children}
      </Button>
      {menuItems.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={variant}
              size="icon"
              disabled={disabled}
              className="border-l border-l-foreground/10"
            >
              <RiArrowDownSLine className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menuItems.map((item) => (
              <DropdownMenuItem
                key={item.label}
                onClick={item.onClick}
                variant={item.destructive ? "destructive" : "default"}
              >
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export { SplitButton, type SplitButtonMenuItem };
