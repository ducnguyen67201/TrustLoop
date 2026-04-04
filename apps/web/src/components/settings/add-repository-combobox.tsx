"use client";

import { toggleRepositorySelectionAction } from "@/app/[workspaceId]/settings/github/actions";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { RepositorySummary } from "@shared/types";
import { RiAddLine, RiGithubLine } from "@remixicon/react";
import { useRef, useState } from "react";

/**
 * Searchable combobox to pick an available repo and add it to the index.
 * Client component because it needs interactive search state.
 */
export function AddRepositoryCombobox({
  workspaceId,
  available,
}: {
  workspaceId: string;
  available: RepositorySummary[];
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const repoIdRef = useRef<HTMLInputElement>(null);

  function handleSelect(repoId: string) {
    if (repoIdRef.current && formRef.current) {
      repoIdRef.current.value = repoId;
      formRef.current.requestSubmit();
    }
    setOpen(false);
  }

  return (
    <div className="flex items-center gap-2">
      <form ref={formRef} action={toggleRepositorySelectionAction} className="hidden">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input ref={repoIdRef} type="hidden" name="repositoryId" value="" />
        <input type="hidden" name="selected" value="true" />
      </form>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <RiAddLine className="size-4" />
            Add repository
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search repositories..." />
            <CommandList>
              <CommandEmpty>No repositories found.</CommandEmpty>
              {available.map((repo) => (
                <CommandItem
                  key={repo.id}
                  value={repo.fullName}
                  onSelect={() => handleSelect(repo.id)}
                  className="flex items-center gap-2"
                >
                  <RiGithubLine className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{repo.fullName}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
