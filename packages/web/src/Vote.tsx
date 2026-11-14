import { useState } from "react";
import { useLocation } from "react-router";
import type { GameView, SharedGame, Viewer, VoteDisplay } from "./api.js";
import { useApi } from "./ApiContext.js";
import { SignInForm, useSignedIn } from "./SignIn.js";

const displays: { display: VoteDisplay; label: string }[] = [
  { display: "live", label: "Live: the counts grow as votes come in" },
  { display: "hidden", label: "Hidden: no counts until you close the vote" },
  { display: "parade", label: "Parade: every Gift scrolls past, as a reminder" },
];

const votesText = (n: number) => `${n} ${n === 1 ? "vote" : "votes"}`;

/** The Worst Gift Vote, once the Game is over: run by the Host, voted in by everyone signed in. */
export function VotePanel({ game, accept }: { game: GameView; accept: (game: SharedGame | null, viewer?: Partial<Viewer>) => void }) {
  const api = useApi();
  const { pathname } = useLocation();
  const signedIn = useSignedIn();
  const [tied, setTied] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runs = game.role !== null;
  const { vote } = game;
  const giftName = (id: string | null) => game.gifts.find((g) => g.id === id)?.name ?? "?";
  const holderOf = (id: string | null) => {
    const holderId = game.gifts.find((g) => g.id === id)?.holderId;
    return game.players.find((p) => p.id === holderId)?.name ?? "nobody";
  };

  if (vote.status === "none" && !runs) return null;

  async function setStatus(status: "open" | "closed", winner?: string) {
    const result = await api.setVoteStatus(game.id, status, winner);
    if (result === "ok") {
      setTied(null);
      setError(null);
    } else if (result === "failed") {
      setError("That didn't work. Please try again.");
    } else {
      setTied(result.tied);
    }
  }

  async function castVote(giftId: string) {
    const myVote = await api.vote(game.id, giftId);
    if (myVote) accept(null, { myVote });
    else setError("Your vote didn't count. Please try again.");
  }

  return (
    <section className="card" aria-label="Worst Gift Vote">
      <h2>Worst Gift Vote</h2>

      {vote.status === "none" && (
        <>
          <p className="muted">Everyone signed in gets one vote for the worst Gift. Its holder picks a prize.</p>
          <button onClick={() => void setStatus("open")}>Start the vote</button>
        </>
      )}

      {vote.status === "open" && (
        <>
          <p aria-live="polite">{votesText(vote.cast)} cast</p>
          {signedIn === true ? (
            <ol className="ballot" aria-label="Vote for the worst Gift">
              {game.gifts.map((g) => (
                <li key={g.id}>
                  <button className="ballot-choice" aria-pressed={game.myVote === g.id} onClick={() => void castVote(g.id)}>
                    <strong>{g.name}</strong> <span className="muted">· {holderOf(g.id)}</span>
                    {vote.counts && <span className="ballot-count">{votesText(vote.counts[g.id] ?? 0)}</span>}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            signedIn === false && <SignInForm next={pathname} heading="Sign in to vote" />
          )}
          {runs && (
            <>
              <fieldset className="choices">
                <legend>The big screen shows</legend>
                {displays.map(({ display, label }) => (
                  <label key={display}>
                    <input
                      type="radio"
                      name="vote-display"
                      checked={vote.display === display}
                      onChange={() => void api.setVoteDisplay(game.id, display)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              {tied ? (
                <div role="group" aria-label="Pick the winner" className="stack">
                  <p>These are tied for the most votes. Pick the winner:</p>
                  {tied.map((id) => (
                    <button key={id} onClick={() => void setStatus("closed", id)}>
                      {giftName(id)}
                    </button>
                  ))}
                </div>
              ) : (
                <button onClick={() => void setStatus("closed")}>Close the vote and reveal</button>
              )}
            </>
          )}
        </>
      )}

      {vote.status === "closed" && (
        <>
          {vote.winner ? (
            <p className="winner">
              Worst Gift: {giftName(vote.winner)}, held by {holderOf(vote.winner)}, who picks a prize!
            </p>
          ) : (
            <p className="muted">Nobody voted.</p>
          )}
          {vote.counts && (
            <ol className="results" aria-label="Results">
              {[...game.gifts]
                .filter((g) => (vote.counts![g.id] ?? 0) > 0)
                .sort((a, b) => (vote.counts![b.id] ?? 0) - (vote.counts![a.id] ?? 0))
                .map((g) => (
                  <li key={g.id}>
                    {g.name} <span className="muted">· {votesText(vote.counts![g.id] ?? 0)}</span>
                  </li>
                ))}
            </ol>
          )}
          {runs && (
            <button className="secondary" onClick={() => void setStatus("open")}>
              Reopen the vote
            </button>
          )}
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
