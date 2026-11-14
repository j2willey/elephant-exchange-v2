import type { Command, GameSettings, Phase, RuleErrorCode } from "@elephant/rules";
import { io } from "socket.io-client";

/** A Game as the server shows it (see view() in the server). */
export interface GameView {
  id: string;
  /** Rises with every change; the newest copy wins. */
  version: number;
  phase: Phase;
  settings: GameSettings;
  players: { id: string; name: string }[];
  active: string[];
  onDeck: string[];
  gifts: { id: string; name: string; holderId: string | null; steals: number; frozen: boolean }[];
  /** Whether the person looking runs this Game. */
  role: "host" | "cohost" | null;
}

export type CommandResult = { ok: true; game: Omit<GameView, "role"> } | { ok: false; code: RuleErrorCode | "Forbidden" | "Failed"; message: string };

export interface ApiOptions {
  /** Where live updates come from; the page's own origin when left out. */
  socketOrigin?: string;
  /** Socket.IO transports; left out, it starts with polling and upgrades, which gets through strict networks. */
  transports?: ("polling" | "websocket")[];
}

/** Talks to the server. Screens use this, never fetch directly, so tests can hand in a browser with a cookie jar. */
export function createApi(fetchFn: typeof fetch = (input, init) => fetch(input, init), options: ApiOptions = {}) {
  const postJson = (path: string, body?: unknown) =>
    fetchFn(path, {
      method: "POST",
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });

  return {
    /** Who is signed in on this browser, if anyone. */
    async session(): Promise<{ email: string } | undefined> {
      const res = await fetchFn("/api/session");
      if (res.status === 401) return undefined;
      if (!res.ok) throw new Error(`session check failed: ${res.status}`);
      return (await res.json()) as { email: string };
    },

    async requestLink(email: string): Promise<"sent" | "tooMany" | "invalidEmail"> {
      const res = await postJson("/api/auth/link", { email });
      if (res.status === 202) return "sent";
      if (res.status === 429) return "tooMany";
      if (res.status === 400) return "invalidEmail";
      throw new Error(`asking for a link failed: ${res.status}`);
    },

    /** Uses up an emailed link; undefined if it was already used or has expired. */
    async redeemLink(token: string): Promise<{ email: string } | undefined> {
      const res = await postJson("/api/auth/verify", { token });
      if (res.status === 401 || res.status === 400) return undefined;
      if (!res.ok) throw new Error(`signing in failed: ${res.status}`);
      return (await res.json()) as { email: string };
    },

    async signOut(): Promise<void> {
      await postJson("/api/auth/sign-out");
    },

    async createGame(settings: GameSettings): Promise<string> {
      const res = await postJson("/api/games", { settings });
      if (res.status !== 201) throw new Error(`creating a Game failed: ${res.status}`);
      return ((await res.json()) as { id: string }).id;
    },

    /** The Game, or undefined if there's no such Game. */
    async game(id: string): Promise<GameView | undefined> {
      const res = await fetchFn(`/api/games/${encodeURIComponent(id)}`);
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`loading the Game failed: ${res.status}`);
      return (await res.json()) as GameView;
    },

    async addCohost(gameId: string, email: string): Promise<void> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/cohosts`, { email });
      if (res.status !== 204) throw new Error(`adding a Co-host failed: ${res.status}`);
    },

    /**
     * Calls onGame with the whole Game now, and again after every change, until the returned function is called.
     * After a phone sleeps, Socket.IO reconnects by itself and the server sends the whole Game again.
     */
    watch(gameId: string, onGame: (game: Omit<GameView, "role">) => void, onMissing?: () => void): () => void {
      const socketOptions = { auth: { gameId }, ...(options.transports ? { transports: options.transports } : {}) };
      const socket = options.socketOrigin ? io(options.socketOrigin, socketOptions) : io(socketOptions);
      socket.on("game", onGame);
      socket.on("connect_error", (err) => {
        if (err.message === "Game not found") {
          socket.close();
          onMissing?.();
        }
      });
      return () => void socket.close();
    },

    async command(gameId: string, command: Command): Promise<CommandResult> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/commands`, command);
      if (res.ok) return { ok: true, game: (await res.json()) as GameView };
      if (res.status === 409) return { ok: false, ...((await res.json()) as { code: RuleErrorCode; message: string }) };
      if (res.status === 401 || res.status === 403) return { ok: false, code: "Forbidden", message: "Only the Host and Co-hosts can do that." };
      return { ok: false, code: "Failed", message: "Something went wrong. Please try again." };
    },
  };
}

export type Api = ReturnType<typeof createApi>;
