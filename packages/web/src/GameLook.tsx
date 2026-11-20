import { useEffect, useState } from "react";
import type { GameView, MyOrg } from "./api.js";
import { useApi } from "./ApiContext.js";
import party from "./assets/landing-party.webp";
import { ImageField, ThemeColors } from "./Orgs.js";

/**
 * For the Host and Co-hosts: which Organization's Theme the Game shows (one they're the Organizer of, or none),
 * and any part of it the Game overrides for itself. Changes show on every screen at once.
 */
export function GameLook({ game }: { game: GameView }) {
  const api = useApi();
  const [orgs, setOrgs] = useState<MyOrg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { theme } = game;

  useEffect(() => {
    let current = true;
    api.myOrgs().then((mine) => current && setOrgs(mine));
    return () => {
      current = false;
    };
  }, [api]);

  const report = (ok: boolean) => setError(ok ? null : "That didn't work. Please try again.");
  const fallback = theme.organization ? "the Organization's" : "the app's";
  // A Co-host may have picked an Organization this person isn't the Organizer of: still show it as the current one.
  const current = theme.organization && !orgs.some((o) => o.id === theme.organization!.id) ? theme.organization : null;

  return (
    <section className="card" aria-label="How this Game looks">
      <h2>How this Game looks</h2>
      <label htmlFor="game-org">Organization</label>
      <select id="game-org" value={theme.organization?.id ?? ""} onChange={async (e) => report(await api.setGameOrg(game.id, e.target.value || null))}>
        <option value="">None</option>
        {current && <option value={current.id}>{current.name}</option>}
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <p className="muted hint">
        {orgs.length === 0 ? "Create an Organization from your home screen to give your Games its Theme. " : ""}
        Anything set below is for this Game only.
      </p>
      <ThemeColors
        color={theme.color}
        page={theme.page}
        own={{ color: theme.overrides.color, page: theme.overrides.page }}
        fallback={fallback}
        onChange={async (change) => report(await api.editGameTheme(game.id, change))}
      />
      <ImageField
        id="game-logo"
        label="Logo"
        hint={`For this Game only; otherwise ${fallback} is shown.`}
        alt="This Game's own logo"
        url={theme.overrides.logo ? theme.logoUrl : null}
        removeLabel={`Use ${fallback} logo`}
        onChange={async (file) => report(await api.setGameImage(game.id, "logo", file))}
      />
      <ImageField
        id="game-background"
        label="Background image"
        hint={`For this Game only; otherwise ${fallback} is shown.`}
        alt="This Game's own background"
        url={theme.overrides.background ? theme.backgroundUrl : null}
        removeLabel={`Use ${fallback} background`}
        onChange={async (file) => report(await api.setGameImage(game.id, "background", file))}
        ready={{ label: "🎄 Use the holiday party photo", src: party }}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
