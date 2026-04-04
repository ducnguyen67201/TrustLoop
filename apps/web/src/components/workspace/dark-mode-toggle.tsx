"use client";

import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { RiMoonLine, RiSunLine } from "@remixicon/react";
import { useEffect, useState } from "react";

/**
 * Sidebar toggle for dark/light mode.
 * Toggles the `dark` class on <html> for Tailwind dark mode.
 */
export function DarkModeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={toggle} tooltip={dark ? "Light Mode" : "Dark Mode"}>
        {dark ? <RiSunLine /> : <RiMoonLine />}
        <span>{dark ? "Light Mode" : "Dark Mode"}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
