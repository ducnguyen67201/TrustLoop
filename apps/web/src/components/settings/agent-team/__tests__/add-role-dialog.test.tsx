import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddRoleDialog } from "../add-role-dialog";

afterEach(() => {
  cleanup();
});

describe("AddRoleDialog", () => {
  it("defaults the label to the initial role type", async () => {
    render(<AddRoleDialog teamId="team_1" onAddRole={vi.fn(async () => undefined)} />);

    fireEvent.click(screen.getByRole("button", { name: /add role/i }));

    const labelInput = screen.getByLabelText("Label") as HTMLInputElement;
    expect(labelInput.value).toBe("Architect");
  });

  it("explains that role type is a preset while label is customizable", () => {
    render(<AddRoleDialog teamId="team_1" onAddRole={vi.fn(async () => undefined)} />);

    fireEvent.click(screen.getByRole("button", { name: /add role/i }));

    expect(
      screen.getByText(
        /choose a role type for the behavior preset, then use the label to name this agent/i
      )
    ).toBeDefined();
    expect(
      screen.getByText(/role type controls the agent behavior preset\. label is the display name/i)
    ).toBeDefined();
  });

  it("lets the user choose another reviewer instance", () => {
    render(<AddRoleDialog teamId="team_1" onAddRole={vi.fn(async () => undefined)} />);

    fireEvent.click(screen.getByRole("button", { name: /add role/i }));
    fireEvent.click(screen.getByRole("combobox", { name: /role type/i }));
    fireEvent.click(screen.getByRole("option", { name: "Reviewer" }));

    const labelInput = screen.getByLabelText("Label") as HTMLInputElement;
    expect(labelInput.value).toBe("Reviewer");
  });
});
