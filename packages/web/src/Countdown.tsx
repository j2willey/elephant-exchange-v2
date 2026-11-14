import { useEffect, useMemo, useState } from "react";
import type { GameView } from "./api.js";
import { useApi } from "./ApiContext.js";

/**
 * How far this device's clock is from the server's, worked out from the newest copy of the Game: a phone set a few
 * minutes wrong still counts down with everyone else. (The copy's time in transit is too small to matter for a guide.)
 */
function useServerTime(serverNowWhenSent: number): () => number {
  const api = useApi();
  // Worked out when a new copy arrives (its server time changes), not on every redraw.
  const skew = useMemo(() => serverNowWhenSent - api.now(), [serverNowWhenSent, api]);
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
