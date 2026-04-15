import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamListSection } from "../team-list-section";

afterEach(() => {
  cleanup();
});

describe("TeamListSection", () => {
  it("renders teams with default badge and counts", () => {
    render(
      <TeamListSection
        teams={[
          {
            id: "team_1",
            workspaceId: "ws_1",
            name: "Backend Review Team",
            description: "Covers RCA and PR prep.",
            isDefault: true,
            roles: [],
            edges: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]}
        selectedTeamId="team_1"
        canManage
        onSelectTeam={vi.fn()}
        onSetDefaultTeam={vi.fn(async () => undefined)}
        onDeleteTeam={vi.fn(async () => undefined)}
        createTeamDialog={<button type="button">Create team</button>}
      />
    );

    expect(screen.getByText("Backend Review Team")).toBeTruthy();
    expect(screen.getByText("Default")).toBeTruthy();
    expect(screen.getByText(/0 roles/i)).toBeTruthy();
  });
});
