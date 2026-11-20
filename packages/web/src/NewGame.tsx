import { RECOMMENDED_OPTIONS, type GameOptions } from "@elephant/rules";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { MyOrg, NewGameRequest, Session } from "./api.js";
import { useApi } from "./ApiContext.js";
import { fromDraft, GameOptionFields, optionsInWords, toDraft, type OptionDraft } from "./GameOptionFields.js";
import { TipNoteDialog } from "./Landing.js";

const same = (a: GameOptions, b: GameOptions) => (Object.keys(a) as (keyof GameOptions)[]).every((k) => a[k] === b[k]);

/**
 * Creating a Game. A first-time Host picks "Use recommended settings" or "Customize settings"; the full list explains
 * every option, and "Always start with these settings" saves them to their account, so next time one tap creates the
 * Game with them. Whatever is chosen can be changed later in the Game's Settings.
 *
 * `tipNoteRead`: whether this Host has read and considered Jim's tip note; until then New Game shows it first.
 */
export function NewGame({
  session,
  onTipNoteRead,
  onOptionsSaved,
}: {
  session: Session;
  onTipNoteRead: () => void;
  onOptionsSaved: (options: GameOptions | null, always: boolean) => void;
}) {
  const api = useApi();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [noting, setNoting] = useState(false);
  const [name, setName] = useState("Gift exchange");
  const [orgs, setOrgs] = useState<MyOrg[]>([]);
  const [orgId, setOrgId] = useState("");
  const [customizing, setCustomizing] = useState(false);
  const saved = session.myOptions;
  const [draft, setDraft] = useState<OptionDraft>(toDraft(saved ?? RECOMMENDED_OPTIONS));
  const [always, setAlways] = useState(session.alwaysMyOptions);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    api.myOrgs().then((mine) => current && setOrgs(mine));
    return () => {
      current = false;
    };
  }, [api, open]);

  if (!open)
    return (
      <>
        <button onClick={() => (session.tipNoteRead ? setOpen(true) : setNoting(true))}>New Game</button>
        {noting && (
          <TipNoteDialog
            onClose={() => setNoting(false)}
            onContinue={(read) => {
              setNoting(false);
              setOpen(true);
              if (read) {
                onTipNoteRead();
                void api.markTipNoteRead();
              }
            }}
          />
        )}
      </>
    );

  async function create(request: Omit<NewGameRequest, "name" | "orgId">) {
    setBusy(true);
    setFailed(false);
    try {
      const id = await api.createGame({ name: name.trim(), orgId: orgId || undefined, ...request });
      if (request.remember === true) onOptionsSaved(request.options, true);
      if (request.remember === false) onOptionsSaved(saved, false);
      navigate(`/games/${id}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  function submitCustom(e: FormEvent) {
    e.preventDefault();
    const options = fromDraft(draft);
    // Opened the list but changed nothing: still the recommended (or their saved) settings, for the statistics.
    const start = same(options, RECOMMENDED_OPTIONS) ? "recommended" : saved && session.alwaysMyOptions && same(options, saved) ? "saved" : "customized";
    void create({ options, start, looked: true, remember: always });
  }

  const usesSaved = session.alwaysMyOptions && saved !== null;

  return (
    <form className="card stack new-game" onSubmit={customizing ? submitCustom : (e) => e.preventDefault()}>
      <h2>New Game</h2>
      <p className="playbook-nudge">
        📖 New to hosting, or want a refresher? The <Link to="/guide">Host's Guide</Link> explains how the game
        works and how to run a smooth party.
      </p>
      <label htmlFor="game-name">Name of the Game</label>
      <input id="game-name" required maxLength={100} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      {orgs.length > 0 && (
        <>
          <label htmlFor="new-game-org">Organization</label>
          <select id="new-game-org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">None (the app's own look)</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </>
      )}

      {!customizing && usesSaved && (
        <>
          <p className="muted hint">Your settings: {optionsInWords(saved)}</p>
          <button type="button" disabled={busy || !name.trim()} onClick={() => void create({ options: saved, start: "saved" })}>
            Create the Game
          </button>
          <button type="button" className="link" onClick={() => setCustomizing(true)}>
            Change my settings
          </button>
        </>
      )}

      {!customizing && !usesSaved && (
        <>
          <div className="inline start-choices">
            <button type="button" disabled={busy || !name.trim()} onClick={() => void create({ options: { ...RECOMMENDED_OPTIONS }, start: "recommended" })}>
              Use recommended settings
            </button>
            <button type="button" className="secondary" onClick={() => setCustomizing(true)}>
              Customize settings
            </button>
          </div>
          <p className="muted hint">You can change any setting later, in the Game's Settings.</p>
        </>
      )}

      {customizing && (
        <>
          <p className="muted hint">
            The recommended settings suit most parties. Tap ⓘ to see what each one is for. You can change any of them later,
            in the Game's Settings.
          </p>
          <GameOptionFields value={draft} onChange={setDraft} />
          <button type="button" className="link" onClick={() => setDraft(toDraft(RECOMMENDED_OPTIONS))}>
            Back to the recommended settings
          </button>
          <label className="check">
            <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} /> Always start with these settings
          </label>
          <button type="submit" disabled={busy}>
            Create the Game
          </button>
        </>
      )}

      {failed && (
        <p className="error" role="alert">
          The Game couldn't be created. Please try again.
        </p>
      )}
    </form>
  );
}
