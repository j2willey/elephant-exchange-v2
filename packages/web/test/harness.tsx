import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach } from "vitest";
import type { DrawFn } from "@elephant/rules";
import { createServer, type Mailer } from "@elephant/server";
import { createApi, type Api } from "../src/api.js";
import { ApiProvider } from "../src/ApiContext.js";
import { AppRoutes } from "../src/App.js";

const running: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of running.splice(0)) await close();
});

/** Starts the real server, in memory on a free port. Sign-in links are kept in `sent` instead of emailed. */
export async function startServer(options: { draw?: DrawFn } = {}) {
  const sent: { email: string; url: string }[] = [];
  const mailer: Mailer = {
    async sendSignInLink(email, url) {
      sent.push({ email, url });
    },
  };
  const server = createServer({ dbPath: ":memory:", mailer, baseUrl: "http://app.test", ...options });
  const { port, close } = await server.listen(0);
  running.push(close);
  /** The path (with its token) of the latest link emailed to this address, as the app would be opened at. */
  const linkFor = (email: string) => {
    const link = sent.filter((m) => m.email === email).at(-1);
    if (!link) throw new Error(`no link was emailed to ${email}`);
    const url = new URL(link.url);
    return url.pathname + url.search;
  };
  const origin = `http://localhost:${port}`;
  /** A browser already signed in as this person (by the same emailed-link steps the screens use). */
  const signedIn = async (email: string) => {
    const api = browser(origin);
    await api.requestLink(email);
    const token = new URLSearchParams(linkFor(email).split("?")[1]).get("token")!;
    if (!(await api.redeemLink(token))) throw new Error(`could not sign in ${email}`);
    return api;
  };
  return { origin, sent, linkFor, signedIn };
}

/** Always draws the earliest-added Player still waiting, so tests know who is called up without knowing ids. */
export const drawInOrder: DrawFn = (candidates) => candidates[0]!;

/**
 * One person's browser: requests go to the server and cookies are kept between them, as a browser would.
 * Rendering the app again with the same browser is like reloading the page.
 */
export function browser(origin: string): Api {
  const jar = new Map<string, string>();
  const fetchWithCookies: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await fetch(new URL(String(input), origin), { ...init, headers });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const [name, value = ""] = pair!.split("=");
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === "";
      if (expired) jar.delete(name!.trim());
      else jar.set(name!.trim(), value);
    }
    return res;
  };
  return createApi(fetchWithCookies);
}

/** Opens the app at this path in this browser. */
export function openApp(api: Api, path = "/") {
  return render(
    <StrictMode>
      <ApiProvider api={api}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </ApiProvider>
    </StrictMode>,
  );
}
