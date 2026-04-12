import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import { LoginForm } from "../src/components/auth/login-form";

afterEach(() => {
  cleanup();
});

describe("LoginForm", () => {
  it("renders Google as the only sign-in path when OAuth is enabled", () => {
    render(<LoginForm googleBanner={null} googleEnabled />);

    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByText(/or use email and password/i)).toBeNull();
  });

  it("surfaces an operational error when Google OAuth is not configured", () => {
    render(<LoginForm googleBanner={null} googleEnabled={false} />);

    expect(screen.queryByRole("button", { name: /continue with google/i })).toBeNull();
    expect(screen.getByText(/google sign-in is not configured/i)).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("displays the Google banner when sign-in failed upstream", () => {
    render(<LoginForm googleBanner="Something went wrong" googleEnabled />);

    expect(screen.getByText(/something went wrong/i)).toBeTruthy();
  });
});
