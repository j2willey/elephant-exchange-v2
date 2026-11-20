import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { ColorChange, MyOrg } from "./api.js";
import { useApi } from "./ApiContext.js";
import party from "./assets/landing-party.webp";
import { ConfirmDelete } from "./ConfirmDelete.js";

/** The app's own colors, shown in a color picker when a Theme leaves that part unset. Kept in step with styles.css. */
export const APP_COLORS = { color: "#b3202e", page: "#f6f4f1" };

/** The Organizations this person is the Organizer of, and a way to create one; on the home screen. */
export function MyOrgs() {
  const api = useApi();
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<MyOrg[] | null>(null);
  const [name, setName] = useState("");
  const [failed, setFailed] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api.myOrgs().then((loaded) => current && setOrgs(loaded));
    return () => {
      current = false;
    };
  }, [api]);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      navigate(`/orgs/${await api.createOrg(name.trim())}`);
    } catch {
      setFailed(true);
    }
  }

  return (
    <section className="card" aria-label="Your Organizations">
      <h2>Your Organizations</h2>
      <p className="muted hint">
        Optional. An Organization is a saved look (colors, logo, background) that dresses up every Game you run for it. To
        start a Game, use New Game above.
      </p>
      {orgs && orgs.length > 0 && (
        <ul className="my-games">
          {orgs.map((o) => (
            <li key={o.id} aria-label={o.name}>
              <span className="row-with-delete">
                <Link to={`/orgs/${o.id}`}>{o.name}</Link>
                {deleting !== o.id && (
                  <button className="link danger" aria-label={`Delete ${o.name}`} onClick={() => setDeleting(o.id)}>
                    Delete
                  </button>
                )}
              </span>
              {deleting === o.id && (
                <ConfirmDelete
                  question={`Delete ${o.name} and its colors, logo and background? Games that used its look keep going, in the app's own colors. This can't be undone.`}
                  yes={`Yes, delete ${o.name}`}
                  onNo={() => setDeleting(null)}
                  onYes={async () => {
                    const ok = await api.deleteOrg(o.id);
                    if (ok) {
                      setDeleting(null);
                      setOrgs((list) => list && list.filter((x) => x.id !== o.id));
                    }
                    return ok;
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="stack" onSubmit={create}>
        <label htmlFor="new-org">New Organization's name</label>
        <input id="new-org" required maxLength={100} placeholder="Troop 7" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="secondary" disabled={!name.trim()}>
          Create Organization
        </button>
        {failed && (
          <p className="error" role="alert">
            That didn't work. Please try again.
          </p>
        )}
      </form>
    </section>
  );
}

/** Setting an Organization's Theme: only its Organizer gets here. */
export function OrgPage() {
  const api = useApi();
  const { orgId = "" } = useParams();
  const [org, setOrg] = useState<MyOrg | null | "loading">("loading");

  useEffect(() => {
    let current = true;
    api.myOrgs().then((mine) => current && setOrg(mine.find((o) => o.id === orgId) ?? null));
    return () => {
      current = false;
    };
  }, [api, orgId]);

  if (org === "loading") return <p className="muted">Loading…</p>;
  if (!org) return <p className="error">Only its Organizer can change an Organization. You can create your own from your home screen.</p>;

  const update = (next: MyOrg | undefined) => next && setOrg(next);

  return (
    <div className="stack">
      <section className="card">
        <h2>{org.name}</h2>
        <p className="muted">Its Theme shows on every Game you run for it, unless a Game sets its own.</p>
        <Link to="/">Back to your Games</Link>
      </section>
      <ThemeColors
        color={org.color}
        page={org.page}
        fallback="the app's"
        onChange={async (change) => update(await api.editOrg(org.id, change))}
      />
      <section className="card">
        <h2>Images</h2>
        <ImageField
          id="org-logo"
          label="Logo"
          alt={`${org.name} logo`}
          url={org.logoUrl}
          removeLabel="Remove the logo"
          onChange={async (file) => update(await api.setOrgImage(org.id, "logo", file))}
        />
        <ImageField
          id="org-background"
          label="Background image"
          hint="Shown behind the Game's pages and the big screen."
          alt={`${org.name} background`}
          url={org.backgroundUrl}
          removeLabel="Remove the background"
          onChange={async (file) => update(await api.setOrgImage(org.id, "background", file))}
          ready={{ label: "🎄 Use the holiday party photo", src: party }}
        />
      </section>
    </div>
  );
}

/**
 * A Theme's two colors, each picked then saved together, or handed back (to the Organization's, or the app's own:
 * `fallback` says which, for the buttons).
 */
export function ThemeColors({
  color,
  page,
  own = { color: color !== null, page: page !== null },
  fallback,
  onChange,
}: {
  /** The colors in effect (null: the app's own). */
  color: string | null;
  page: string | null;
  /** Which of them are set here, and so can be handed back; by default, whichever are set. */
  own?: { color: boolean; page: boolean };
  fallback: string;
  onChange: (change: ColorChange) => Promise<void>;
}) {
  const [main, setMain] = useState(color ?? APP_COLORS.color);
  const [background, setBackground] = useState(page ?? APP_COLORS.page);
  useEffect(() => setMain(color ?? APP_COLORS.color), [color]);
  useEffect(() => setBackground(page ?? APP_COLORS.page), [page]);

  return (
    <section className="card">
      <h2>Colors</h2>
      <div className="color-row">
        <label htmlFor="theme-color">Main color</label>
        <input id="theme-color" type="color" value={main} onChange={(e) => setMain(e.target.value)} />
        <span className="muted hint">Buttons, headings and the big screen's highlights.</span>
        {own.color && (
          <button type="button" className="link" onClick={() => void onChange({ color: null })}>
            Use {fallback} main color
          </button>
        )}
      </div>
      <div className="color-row">
        <label htmlFor="theme-page">Page color</label>
        <input id="theme-page" type="color" value={background} onChange={(e) => setBackground(e.target.value)} />
        <span className="muted hint">Behind the cards. Text colors adjust so they stay readable.</span>
        {own.page && (
          <button type="button" className="link" onClick={() => void onChange({ page: null })}>
            Use {fallback} page color
          </button>
        )}
      </div>
      <button type="button" onClick={() => void onChange({ color: main, page: background })}>
        Save colors
      </button>
    </section>
  );
}

/** Picking an image (uploaded at once), with a preview of the one in use and a way to remove it. */
export function ImageField({
  id,
  label,
  hint,
  alt,
  url,
  removeLabel,
  onChange,
  ready,
}: {
  id: string;
  label: string;
  hint?: string;
  alt: string;
  url: string | null;
  removeLabel: string;
  onChange: (file: File | null) => Promise<void>;
  /** A ready-made image the app comes with, offered in one tap, for a Host without one of their own. */
  ready?: { label: string; src: string };
}) {
  const [busy, setBusy] = useState(false);
  const [readyFailed, setReadyFailed] = useState(false);
  const change = async (file: File | null) => {
    setBusy(true);
    setReadyFailed(false);
    await onChange(file);
    setBusy(false);
  };
  // Sent like any image the Host picks, so it's stored and shown the same way.
  const useReady = async (src: string) => {
    setBusy(true);
    setReadyFailed(false);
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`${res.status}`);
      await onChange(new File([await res.arrayBuffer()], "ready-made.webp", { type: "image/webp" }));
    } catch {
      setReadyFailed(true); // whatever was there stays
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="image-field">
      <label htmlFor={id}>{label}</label>
      {hint && <span className="muted hint">{hint}</span>}
      {url && <img src={url} alt={alt} className="image-preview" />}
      <input
        id={id}
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void change(file);
        }}
      />
      {ready && (
        <button type="button" className="link" disabled={busy} onClick={() => void useReady(ready.src)}>
          {ready.label}
        </button>
      )}
      {readyFailed && (
        <p className="error" role="alert">
          That didn't load. Please try again.
        </p>
      )}
      {url && (
        <button type="button" className="link danger" disabled={busy} onClick={() => void change(null)}>
          {removeLabel}
        </button>
      )}
    </div>
  );
}
