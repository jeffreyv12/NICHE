import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "../email.js";

// Mock global fetch so tests never hit the network.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

afterEach(() => {
  vi.unstubAllEnvs();
  mockFetch.mockReset();
});

describe("sendEmail", () => {
  it("returns ok=false without calling fetch when RESEND_API_KEY is absent", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const result = await sendEmail({
      to: "user@example.com",
      subject: "Test",
      text: "Hello",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/RESEND_API_KEY/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("POSTs to Resend API with correct headers and body", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Test <test@example.com>");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg-001" }),
    });

    const result = await sendEmail({
      to: "op@example.com",
      subject: "Niche ready",
      text: "Your niche is ready.",
    });

    expect(result.ok).toBe(true);
    expect(result.id).toBe("msg-001");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)?.Authorization).toBe("Bearer re_test_key");

    const body = JSON.parse(init.body as string);
    expect(body.to).toBe("op@example.com");
    expect(body.subject).toBe("Niche ready");
    expect(body.from).toBe("Test <test@example.com>");
  });

  it("falls back to default EMAIL_FROM when env var is not set", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    // Do NOT stub EMAIL_FROM — leave it undefined so the ?? fallback activates.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg-002" }),
    });

    await sendEmail({ to: "x@x.nl", subject: "Hi", text: "body" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.from).toMatch(/NicheFinder/);
  });

  it("wraps plain text in <pre> when html is not supplied", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_key");
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: "x" }) });

    await sendEmail({ to: "a@b.nl", subject: "s", text: "plain text" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.html).toContain("<pre>plain text</pre>");
  });

  it("uses provided html body verbatim when supplied", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_key");
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: "y" }) });

    await sendEmail({
      to: "a@b.nl",
      subject: "s",
      text: "plain",
      html: "<b>bold</b>",
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.html).toBe("<b>bold</b>");
  });

  it("returns ok=false on non-200 Resend response", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_key");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => '{"message":"invalid_parameter"}',
    });

    const result = await sendEmail({ to: "a@b.nl", subject: "s", text: "t" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/422/);
  });
});
