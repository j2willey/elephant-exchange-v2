import { useCallback, useEffect, useState } from "react";
import type { GameView } from "./api.js";
import { useApi } from "./ApiContext.js";

type Shown = Omit<GameView, "role">;

/**
 * The Game, kept current: loaded once (which also says the viewer's role), then updated live.
 * Copies arrive both from live updates and from this screen's own commands, in no guaranteed order,
 * so an older copy never replaces a newer one.
 * Returns "loading" at first, null if there's no such Game, and a function to accept a copy from a command.
 */
export function useLiveGame(id: string): [GameView | null | "loading", (game: Shown) => void] {
  const api = useApi();
  const [game, setGame] = useState<GameView | null | "loading">("loading");

  const accept = useCallback(
    (next: Shown) =>
      setGame((prev) => {
        const known = prev !== "loading" && prev !== null ? prev : undefined;
        if (known && known.version > next.version) return prev;
        return { ...next, role: known?.role ?? null };
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
        // A live update may already have brought something newer: keep that, but take the role from here.
        return known && known.version > loaded.version ? { ...known, role: loaded.role } : loaded;
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
