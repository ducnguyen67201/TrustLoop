import { describe, expect, it } from "vitest";
import { redactText, redactUrl } from "../src/redact";

describe("redactText", () => {
  it("redacts plain emails", () => {
    expect(redactText("Contact marcus@northwind.io for help")).toBe("Contact [email] for help");
  });

  it("redacts emails with subdomains, plus aliases, and dots", () => {
    expect(redactText("from a.b+tag@mail.subdomain.example.co for help")).toBe(
      "from [email] for help"
    );
  });

  it("redacts Bearer and Basic auth tokens", () => {
    expect(redactText("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig")).toBe(
      "Authorization: Bearer [redacted]"
    );
    expect(redactText("Authorization: Basic dXNlcjpwYXNzd29yZA==")).toBe(
      "Authorization: Basic [redacted]"
    );
  });

  it("redacts secret-flavored query string values", () => {
    expect(redactText("/api/x?token=abc123&unrelated=ok")).toBe(
      "/api/x?token=[redacted]&unrelated=ok"
    );
    expect(redactText("/api/x?api_key=abc")).toBe("/api/x?api_key=[redacted]");
    expect(redactText("/api/x?api-key=abc")).toBe("/api/x?api-key=[redacted]");
    expect(redactText("/api/x?apiKey=abc")).toBe("/api/x?apiKey=[redacted]");
    expect(redactText("/api/x?secret=abc")).toBe("/api/x?secret=[redacted]");
    expect(redactText("/api/x?password=abc")).toBe("/api/x?password=[redacted]");
    expect(redactText("/api/x?authorization=abc")).toBe("/api/x?authorization=[redacted]");
  });

  it("redacts long hex runs (32+ chars)", () => {
    const sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(redactText(`hash=${sha256}`)).toBe("hash=[redacted]");

    const md5 = "d41d8cd98f00b204e9800998ecf8427e";
    expect(redactText(`old md5: ${md5}`)).toBe("old md5: [redacted]");
  });

  it("does not over-redact short hex like CSS colors or short IDs", () => {
    expect(redactText("color: #ff00aa; id=ab12cd34")).toBe("color: #ff00aa; id=ab12cd34");
  });

  it("redacts multiple secrets in a single string", () => {
    expect(redactText("user=bob@x.com used Bearer abcdef123 with token=xyz")).toBe(
      "user=[email] used Bearer [redacted] with token=[redacted]"
    );
  });

  it("returns empty string for null, undefined, or empty input", () => {
    expect(redactText(null)).toBe("");
    expect(redactText(undefined)).toBe("");
    expect(redactText("")).toBe("");
  });

  it("does not crash on adversarial inputs", () => {
    expect(redactText("a@b@c@d.example")).toContain("[email]");
    expect(redactText("Bearer ")).toBe("Bearer ");
    expect(redactText("token=")).toBe("token=");
  });
});

describe("redactUrl", () => {
  it("strips query strings and fragments from absolute URLs", () => {
    expect(redactUrl("https://app.example.com/dashboard?token=abc#section")).toBe(
      "https://app.example.com/dashboard"
    );
  });

  it("strips query strings from path-only URLs", () => {
    expect(redactUrl("/api/list?api_key=abc&customer=marcus@x.com")).toBe("/api/list");
  });

  it("redacts emails embedded in path segments after stripping query", () => {
    expect(redactUrl("/users/marcus@northwind.io/edit?token=abc")).toBe("/users/[email]/edit");
  });

  it("falls back to raw-string handling on unparseable URLs", () => {
    expect(redactUrl("not-a-url-but-has?token=abc")).toBe("not-a-url-but-has");
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(redactUrl("")).toBeNull();
    expect(redactUrl("   ")).toBeNull();
    expect(redactUrl(null)).toBeNull();
    expect(redactUrl(undefined)).toBeNull();
  });

  it("preserves origin for absolute URLs (operators need to know the host)", () => {
    expect(redactUrl("https://api.acme.io/v1/widgets?secret=xxx")).toBe(
      "https://api.acme.io/v1/widgets"
    );
  });
});
