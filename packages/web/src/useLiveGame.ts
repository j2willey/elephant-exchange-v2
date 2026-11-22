import { useCallback, useEffect, useState } from "react";
import type { GameView, SharedGame, Viewer } from "./api.js";
import { useApi } from "./ApiContext.js";

/**
 * Whether copy `a` of a Game is newer than copy `b`. The version rises with every Pick but not with a change of
 * setting (a color, the big screen, the vote), so between copies of the same version the one the server sent later
 * is newer: each copy carries the server's time when it was sent.
 */
export const newer = (a: Pick<SharedGame, "version" | "clock">, b: Pick<SharedGame, "version" | "clock">) =>
  a.version > b.version || (a.version === b.version && a.clock.now > b.clock.now);

/**
 * The Game, kept current: loaded once (which also says who the viewer is), then updated live.
 * Copies arrive both from live updates and from this screen's own requests, in no guaranteed order,
 * so an older copy never replaces a newer one (see `newer`).
 * Returns "loading" at first, null if there's no such Game, and a function to accept a copy from a request
 * (with anything new about the viewer, such as the Player they just joined as; null for the Game when only the
 * viewer changed, since a copy at the same version could be older than one already shown), and a count that rises whenever
 * the Feed changes, for whoever shows it to reload it, and another that rises whenever who co-hosts changes.
 */
export function useLiveGame(
  id: string,
): [GameView | null | "loading", (game: SharedGame | null, viewer?: Partial<Viewer>) => void, number, number] {
  const api = useApi();
  const [game, setGame] = useState<GameView | null | "loading">("loading");
  const [feedChanges, setFeedChanges] = useState(0);
  const [staffChanges, setStaffChanges] = useState(0);

  const accept = useCallback(
    (next: SharedGame | null, viewer: Partial<Viewer> = {}) =>
      setGame((prev) => {
        const known = prev !== "loading" && prev !== null ? prev : undefined;
        // Something new about the viewer only (such as their vote): the Game itself comes from live updates.
        if (next === null) return known ? { ...known, ...viewer } : prev;
        const who: Viewer = { role: known?.role ?? null, me: known?.me ?? null, myName: known?.myName ?? null, muted: known?.muted ?? false, myVote: known?.myVote ?? null, ...viewer };
        if (known && newer(known, next)) return { ...known, ...who };
        return { ...next, ...who };
      }),
    [],
  );

  useEffect(() => {
    let current = true;
    api.game(id).then((loaded) => {
      if (!current) return;
      if (!loaded) return setGame(null);
      setGame((prev) => {
        const known = prev !== "loading" && prev !== null ? prev : undefined;
        // A live update may already have brought something as new or newer: keep that, but take the viewer from
        // here. This answer is a one-off snapshot that may have been on its way a while; the live connection sends a
        // copy after every change, so on a tie the copy already shown is kept.
        if (!known || newer(loaded, known)) return loaded;
        const { role, me, myName, muted, myVote } = loaded;
        return { ...known, role, me, myName, muted, myVote };
      });
    });
    const stop = api.watch(
      id,
      (next) => current && accept(next),
      () => current && setGame(null),
      () => current && setFeedChanges((n) => n + 1),
      () => current && setStaffChanges((n) => n + 1),
    );
    return () => {
      current = false;
      stop();
    };
  }, [api, id, accept]);

  return [game, accept, feedChanges, staffChanges];
}
