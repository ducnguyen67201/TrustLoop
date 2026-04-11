import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-auth-session", () => ({
  useAuthSession: () => ({
    login: vi.fn(),
    register: vi.fn(),
    isLoading: false,
  }),
}));

import { LoginForm } from "../src/components/auth/login-form";

afterEach(() => {
  cleanup();
});

describe("LoginForm", () => {
  it("keeps Google as the primary CTA when OAuth is enabled", () => {
    render(<LoginForm googleBanner={null} googleEnabled />);

    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.getByRole("button", { name: /^or use email and password$/i })).toBeTruthy();
  });

  it("shows the password form immediately when Google OAuth is disabled", () => {
    render(<LoginForm googleBanner={null} googleEnabled={false} />);

    expect(screen.queryByRole("button", { name: /continue with google/i })).toBeNull();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.queryByText(/or use email and password/i)).toBeNull();
    expect(screen.getByText(/sign in or create an account with email and password/i)).toBeTruthy();
  });
});
