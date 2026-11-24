/**
 * Plays a guided demo script on a real demo Game, through the same API the Host console uses. No UI: the guided page
 * (Guided.tsx) shows the bubbles and calls `show(k)` and `next()`.
 *
 * The state shown at step k is every action of steps 0..k-1, plus step k's own if it runs on "enter" (FORMAT.md,
 * "Steps"). Going back, or jumping, rebuilds: a fresh demo Game played up to that point without pauses, after which
 * the old one is deleted. Undo can't do it alone, since it covers only the last Pick and not Posts.
 */
import type { Api, SharedGame } from "../api.js";
import type { Action, DemoScript, Step } from "./format.js";
import { checkExpect, commandFor, validate, type Ids } from "./play.js";
import { photoBlob } from "./photos.js";

/** A step the server refused, or a call that failed: the script stops here. */
export class ScriptError extends Error {
  constructor(
    readonly stepId: string,
    message: string,
  ) {
    super(`${stepId}: ${message}`);
  }
}

export interface Runner {
  /** The demo Game now being played; null until the first `show`. */
  gameId(): string | null;
  /** The step now shown. */
  step(): number;
  /** Builds a fresh demo Game showing step k, then deletes the one before. */
  show(k: number): Promise<void>;
  /** Runs this step's "next" actions, if any, then moves to the next step and runs its "enter" actions. */
  next(): Promise<void>;
  /** The id a Gift key or Post ref has in the Game now shown; undefined until it's opened or posted. */
  giftId(key: string): string | undefined;
  postId(ref: string): string | undefined;
  /** Deletes the demo Game (leaving the page). A build still under way is deleted once it's made. */
  dispose(): Promise<void>;
}

export interface RunnerOptions {
  /** A step's `expect` didn't hold: in development the page shows it; the replay carries on either way. */
  onDrift?: (stepId: string, differences: string[]) => void;
}

export function createRunner(api: Api, script: DemoScript, { onDrift }: RunnerOptions = {}): Runner {
  // Which Draws are left before every action: from playing the script through the rules alone (play.ts).
  const { drawsBefore } = validate(script);
  let current: Game | null = null;
  let at = 0;
  let closed = false;

  /** One demo Game, and the script's names, Gift keys and Post refs in it. */
  interface Game {
    id: string;
    players: Map<string, string>;
    names: Map<string, string>;
    gifts: Map<string, string>;
    posts: Map<string, string>;
    last: SharedGame | null;
  }

  async function create(): Promise<Game> {
    await api.startVisitor();
    const id = await api.createGame({ name: script.game.name, options: script.game.options, demo: true });
    await api.setGameOptions(id, {
      ...(script.game.tagline ? { tagline: script.game.tagline } : {}),
      postsPerMinute: script.game.postsPerMinute ?? 0,
      repitchMinutes: script.game.repitchMinutes ?? 0,
    });
    const game: Game = { id, players: new Map(), names: new Map(), gifts: new Map(), posts: new Map(), last: null };
    for (const name of script.players) {
      const playerId = crypto.randomUUID();
      const r = await api.command(id, { type: "AddPlayer", playerId, name });
      if (!r.ok) throw new ScriptError("players", r.message);
      game.players.set(name, playerId);
      game.names.set(playerId, name);
      game.last = r.game;
    }
    return game;
  }

  const idsIn = (game: Game): Ids => ({
    player: (name) => game.players.get(name) ?? name,
    gift: (key) => {
      if (!game.gifts.has(key)) game.gifts.set(key, crypto.randomUUID());
      return game.gifts.get(key)!;
    },
  });

  async function act(game: Game, k: number, i: number, action: Action) {
    const step = script.steps[k]!;
    const fail = (why: string): never => {
      throw new ScriptError(step.id, why);
    };
    const ids = idsIn(game);
    const player = (name: string) => game.players.get(name) ?? fail(`no player "${name}"`);
    const command = commandFor(script, action, ids);
    if (command) {
      const draws = script.draws.slice(drawsBefore[k]?.[i] ?? script.draws.length).map(player);
      const r = await api.command(game.id, command, draws);
      if (!r.ok) fail(r.message);
      else game.last = r.game;
      return;
    }
    switch (action.do) {
      case "post": {
        const as = api.as(player(action.as));
        const text = action.text ?? "";
        const photo = action.photo ? await photoBlob(script, action.photo) : undefined;
        const replyTo = action.replyTo ? (game.posts.get(action.replyTo) ?? fail(`no post "${action.replyTo}" to reply to`)) : undefined;
        const said = await as.post(game.id, {
          text,
          ...(photo ? { photo } : {}),
          ...(action.gift ? { giftId: ids.gift(action.gift) } : {}),
          ...(replyTo ? { replyTo } : {}),
        });
        if (said !== "posted") fail(`${action.as}'s post wasn't posted (${said})`);
        // The server doesn't say which Post it made: it's the newest of theirs with these words (as chatter() does).
        if (action.ref) {
          const theirs = (await as.posts(game.id)).filter((p) => p.mine && (p.text ?? "") === text);
          game.posts.set(action.ref, theirs.at(-1)?.id ?? fail(`can't find ${action.as}'s new post`));
        }
        return;
      }
      case "react": {
        const postId = game.posts.get(action.post) ?? fail(`no post "${action.post}"`);
        if (!(await api.as(player(action.as)).react(game.id, postId, action.emoji, true))) fail(`${action.as} couldn't react`);
        return;
      }
      case "pitch": {
        const photo = action.photo ? await photoBlob(script, action.photo) : undefined;
        const saved = await api.setPitch(game.id, ids.gift(action.gift), { tagline: action.tagline ?? "", text: action.text ?? "", ...(photo ? { photo } : {}) }, player(action.holder));
        if (saved !== "saved") fail(`the Pitch wasn't saved (${saved})`);
        return;
      }
      case "screen":
        if (!(await api.setScreen(game.id, action.mode))) fail(`the scoreboard didn't switch to ${action.mode}`);
        return;
    }
  }

  /** Runs a step's actions, then checks its `expect`. */
  async function runStep(game: Game, k: number) {
    const step: Step = script.steps[k]!;
    const actions = step.actions ?? [];
    for (let i = 0; i < actions.length; i++) await act(game, k, i, actions[i]!);
    if (step.expect && game.last) {
      const ids = idsIn(game);
      const differences = checkExpect(step.expect, game.last, ids, (id) => game.names.get(id) ?? id);
      if (differences.length > 0) onDrift?.(step.id, differences);
    }
  }

  /** Ends a Game still under way (the server never deletes one mid-party), then deletes it. Best effort. */
  async function discard(game: Game) {
    const phase = game.last?.phase;
    if (phase === "playing" || phase === "finalRound") await api.command(game.id, { type: "EndGame" }).catch(() => undefined);
    await api.deleteGame(game.id).catch(() => false);
  }

  const runsOnEnter = (k: number) => (script.steps[k]?.run ?? "enter") === "enter";

  return {
    gameId: () => current?.id ?? null,
    giftId: (key) => current?.gifts.get(key),
    postId: (ref) => current?.posts.get(ref),
    step: () => at,

    async show(k) {
      const target = Math.max(0, Math.min(k, script.steps.length - 1));
      const game = await create();
      if (closed) {
        void discard(game);
        return;
      }
      try {
        for (let j = 0; j < target; j++) await runStep(game, j);
        if (runsOnEnter(target)) await runStep(game, target);
      } catch (e) {
        // The broken Game is still shown, stopped where the script went wrong.
        const old = current;
        current = game;
        at = target;
        if (old) void discard(old);
        throw e;
      }
      const old = current;
      current = game;
      at = target;
      if (old) void discard(old);
    },

    async next() {
      const game = current;
      if (!game || at >= script.steps.length - 1) return;
      if (!runsOnEnter(at)) await runStep(game, at);
      at += 1;
      if (runsOnEnter(at)) await runStep(game, at);
    },

    async dispose() {
      closed = true;
      const old = current;
      current = null;
      if (old) await discard(old);
    },
  };
}
