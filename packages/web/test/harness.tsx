import { File as NodeFile } from "node:buffer";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect } from "vitest";
import type { DrawFn } from "@elephant/rules";
import { createServer, type Mailer } from "@elephant/server";
import { createApi, type Api } from "../src/api.js";
import { ApiProvider } from "../src/ApiContext.js";
import { AppRoutes } from "../src/App.js";

const running: (() => Promise<void>)[] = [];
/** Requests the test browsers have sent and not yet had answered. */
const inFlight = new Set<Promise<unknown>>();
afterEach(async () => {
  // Take the screens down, and let what they already asked for finish, before the server stops: a request
  // cut off mid-answer fails (ECONNRESET) after its test has passed, and fails the run.
  cleanup();
  while (inFlight.size) await Promise.allSettled([...inFlight]);
  for (const close of running.splice(0)) await close();
  clock.reset();
});

/**
 * The time, as the server and every test browser see it: it stands still until a test moves it on.
 * Each browser's clock can be set wrong by some amount, as a phone's can be.
 */
export const clock = {
  ms: Date.UTC(2026, 11, 13, 19, 0, 0),
  now: () => new Date(clock.ms),
  advance(seconds: number) {
    clock.ms += seconds * 1000;
  },
  reset() {
    clock.ms = Date.UTC(2026, 11, 13, 19, 0, 0);
  },
};

/** Starts the real server, in memory on a free port. Sign-in links are kept in `sent` instead of emailed. */
export async function startServer(options: { draw?: DrawFn; adminEmails?: string[] } = {}) {
  const sent: { email: string; url: string }[] = [];
  const mailer: Mailer = {
    async sendSignInLink(email, url) {
      sent.push({ email, url });
    },
  };
  const server = createServer({ dbPath: ":memory:", mailer, baseUrl: "http://app.test", now: clock.now, ...options });
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
  const signedIn = async (email: string, { demoPlayer }: { demoPlayer?: string } = {}) => {
    const api = browser(origin, demoPlayer === undefined ? {} : { demoPlayer });
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
 * Runs a request while the server (in this same process) has Node's own File. jsdom replaces the global
 * File, and Node's multipart parser then fails its own check on the files it reads. Only this test setup
 * has the server and jsdom sharing globals; in production the server runs alone.
 */
async function asNodeServer<T>(request: () => Promise<T>): Promise<T> {
  const jsdomFile = globalThis.File;
  globalThis.File = NodeFile as unknown as typeof File;
  try {
    return await request();
  } finally {
    globalThis.File = jsdomFile;
  }
}

/** A jsdom Blob's bytes (Node's fetch can't read them: it sends a jsdom File as an empty part). */
const bytesOf = (blob: Blob) =>
  new Promise<Uint8Array>((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => fail(reader.error);
    reader.readAsArrayBuffer(blob);
  });

/** Encodes a form as a browser would send it (multipart/form-data), with its files' real bytes. */
async function toMultipart(form: FormData): Promise<{ body: Uint8Array; type: string }> {
  const boundary = `----harness${Math.random().toString(36).slice(2)}`;
  const parts: Uint8Array[] = [];
  const text = (s: string) => parts.push(new TextEncoder().encode(s));
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") {
      text(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
    } else {
      const type = value.type || "application/octet-stream";
      text(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${value.name}"\r\nContent-Type: ${type}\r\n\r\n`);
      parts.push(await bytesOf(value));
      text("\r\n");
    }
  }
  text(`--${boundary}--\r\n`);
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (body.set(p, at), at + p.length), 0);
  return { body, type: `multipart/form-data; boundary=${boundary}` };
}

/**
 * One person's browser: requests go to the server and cookies are kept between them, as a browser would.
 * Rendering the app again with the same browser is like reloading the page; its Stars are kept too.
 */
export function browser(origin: string, { clockWrongBy = 0, demoPlayer }: { clockWrongBy?: number; demoPlayer?: string } = {}): Api {
  const jar = new Map<string, string>();
  const fetchWithCookies: typeof fetch = (input, init) => {
    const request = send(input, init);
    inFlight.add(request);
    void request.finally(() => inFlight.delete(request)).catch(() => {});
    return request;
  };
  const send: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const body = init?.body;
    let res: Response;
    if (body instanceof FormData) {
      const multipart = await toMultipart(body);
      headers.set("content-type", multipart.type);
      res = await asNodeServer(() => fetch(new URL(String(input), origin), { ...init, headers, body: multipart.body as BodyInit }));
    } else {
      res = await fetch(new URL(String(input), origin), { ...init, headers, ...(body === undefined ? {} : { body }) });
    }
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const [name, value = ""] = pair!.split("=");
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === "";
      if (expired) jar.delete(name!.trim());
      else jar.set(name!.trim(), value);
    }
    return res;
  };
  // Each browser has its own device storage, as two phones would.
  const kept = new Map<string, string>();
  const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value) };
  return createApi(fetchWithCookies, {
    socketOrigin: origin,
    transports: ["websocket"],
    storage,
    now: () => clock.ms + clockWrongBy * 1000,
    ...(demoPlayer === undefined ? {} : { demoPlayer }),
  });
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

/**
 * On a guest's phone, shows the panel behind the tab `name` (Gifts, Up now, Feed, Post); on the Host's console,
 * which has no tabs, does nothing. Waits for the Game to load first, since the tabs come with it.
 */
export async function onTab(name: RegExp, phone: HTMLElement = document.body) {
  await waitFor(() => expect(within(phone).queryByText(/^loading…$/i)).not.toBeInTheDocument());
  const tab = within(phone).queryByRole("tab", { name });
  if (tab && tab.getAttribute("aria-selected") !== "true") fireEvent.click(tab);
}
