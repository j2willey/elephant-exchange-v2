import { useEffect, useMemo, useRef, useState } from "react";
import type { GameView } from "./api.js";
import { useApi } from "./ApiContext.js";

/**
 * How far this device's clock is from the server's, so a phone set a few minutes wrong still counts down with
 * everyone else. Each copy of the Game says the server's time when it was sent; it arrives a little later, so it
 * always makes this device seem a little fast, by its time in transit. The copy that seems to make it least fast
 * came the quickest, so that's the guide kept: a copy that took its time (a slow connection, a busy phone) never
 * pulls the countdown back.
 */
export function useServerTime(serverNowWhenSent: number): () => number {
  const api = useApi();
  const best = useRef<number | undefined>(undefined);
  // Worked out when a new copy arrives (its server time changes), not on every redraw.
  const skew = useMemo(() => {
    const seen = serverNowWhenSent - api.now();
    best.current = best.current === undefined ? seen : Math.max(best.current, seen);
    return best.current;
  }, [serverNowWhenSent, api]);
  return () => api.now() + skew;
}

/** Redraws whatever uses it a few times a second. */
function useTicking() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const ticking = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(ticking);
  }, []);
}

/**
 * A Player's turn timer: a guide for the Host, never a rule. Amber from 30 seconds left, red from 10, and then
 * "Time's up" — the Player keeps their Turn until the Host moves on.
 */
export function Countdown({ game, playerId, name }: { game: GameView; playerId: string; name: string }) {
  useTicking();
  const serverNow = useServerTime(game.clock.now);
  const startedAt = game.clock.startedAt[playerId];
  if (!game.clock.turnSeconds || startedAt === undefined) return null;

  const left = game.clock.turnSeconds - Math.floor(Math.max(0, serverNow() - startedAt) / 1000);
  const state = left <= 0 ? "up" : left <= 10 ? "urgent" : left <= 30 ? "warning" : "plenty";
  const shown = left <= 0 ? "Time's up" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <span className="countdown" role="timer" aria-label={`${name}'s time`} data-state={state}>
      {shown}
    </span>
  );
}
