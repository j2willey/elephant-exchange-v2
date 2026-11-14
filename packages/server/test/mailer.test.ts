import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { resendMailer } from "../src/mailer.js";
import { post } from "./support.js";

/** Stands in for the network: records each request and answers with the given status. */
function fakeFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(status < 300 ? { id: "email-1" } : { message: "nope" }), { status });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const link = "https://swap.example.com/sign-in?token=abc&next=%2Fgames%2Fg1";

describe("Emailing sign-in links through Resend", () => {
  it("sends one email to the person, from our address, with the link in it", async () => {
    const { calls, fetch } = fakeFetch();
    const mailer = resendMailer({ apiKey: "re_test", from: "Elephant Exchange <signin@swap.example.com>", fetch });

    await mailer.sendSignInLink("ann@example.com", link);

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer re_test");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: "Elephant Exchange <signin@swap.example.com>", to: ["ann@example.com"] });
    expect(body.subject).toMatch(/sign in/i);
    expect(body.text).toContain(link);
    // In HTML the & must be written &amp;, or some mail apps mangle the link.
    expect(body.html).toContain(link.replaceAll("&", "&amp;"));
    expect(body.text).toMatch(/15 minutes/);
  });

  it("fails loudly when Resend refuses, such as over the daily limit", async () => {
    const { fetch } = fakeFetch(429);
    const mailer = resendMailer({ apiKey: "re_test", from: "x@swap.example.com", fetch });
    await expect(mailer.sendSignInLink("ann@example.com", link)).rejects.toThrow(/429/);
  });
});

describe("Asking for a sign-in link when email can't be sent", () => {
  it("tells the person to try again, rather than pretending a link is on its way", async () => {
    const mailer = { sendSignInLink: async () => Promise.reject(new Error("Resend said 429")) };
    const { app } = createServer({ dbPath: ":memory:", mailer });

    const res = await app.request("/api/auth/link", post({ email: "ann@example.com" }));

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/couldn't send/i);
  });
});
