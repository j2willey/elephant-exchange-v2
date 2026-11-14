import { useCallback, useEffect, useState } from "react";
import type { GameView, SharedGame, Viewer } from "./api.js";
import { useApi } from "./ApiContext.js";

/**
 * The Game, kept current: loaded once (which also says who the viewer is), then updated live.
 * Copies arrive both from live updates and from this screen's own requests, in no guaranteed order,
 * so an older copy never replaces a newer one.
 * Returns "loading" at first, null if there's no such Game, and a function to accept a copy from a request
 * (with anything new about the viewer, such as the Player they just joined as).
 */
export function useLiveGame(id: string): [GameView | null | "loading", (game: SharedGame, viewer?: Partial<Viewer>) => void] {
  const api = useApi();
  const [game, setGame] = useState<GameView | null | "loading">("loading");

  const accept = useCallback(
    (next: SharedGame, viewer: Partial<Viewer> = {}) =>
      setGame((prev) => {
        const known = prev !== "loading" && prev !== null ? prev : undefined;
        const who: Viewer = { role: known?.role ?? null, me: known?.me ?? null, ...viewer };
        if (known && known.version > next.version) return { ...known, ...who };
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
        // A live update may already have brought something newer: keep that, but take the viewer from here.
        return known && known.version > loaded.version ? { ...known, role: loaded.role, me: loaded.me } : loaded;
      });
    });
    const stop = api.watch(id, (next) => current && accept(next), () => current && setGame(null));
    return () => {
      current = false;
      stop();
    };
  }, [api, id, accept]);

  return [game, accept];
}
