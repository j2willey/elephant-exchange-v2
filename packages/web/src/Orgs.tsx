import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { ColorChange, MyOrg } from "./api.js";
import { useApi } from "./ApiContext.js";
import { Backdrop } from "./Backdrop.js";
import { ConfirmDelete } from "./ConfirmDelete.js";
import { LOOKS, type Look } from "./looks.js";

/** The app's own colors, shown in a color picker when a Theme leaves that part unset. Kept in step with styles.css. */
export const APP_COLORS = { color: "#b3202e", page: "#f6f4f1" };

/**
 * The Organizations this person is the Organizer of, and a way to create one: tucked inside Your Games on the home
 * screen, folded away, since most Hosts just run a Game and never need one. Open from the start for anyone who has one.
 */
export function MyOrgs() {
  const api = useApi();
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<MyOrg[] | null>(null);
  const [name, setName] = useState("");
  const [failed, setFailed] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let current = true;
    api.myOrgs().then((loaded) => {
      if (!current) return;
      setOrgs(loaded);
      if (loaded.length > 0) setOpen(true);
    });
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
    <details className="my-orgs" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>🎨 Organizations {orgs && orgs.length > 0 ? `(${orgs.length})` : "(optional)"}</summary>
      <section aria-label="Your Organizations">
        <p className="muted hint">
          Optional, for Hosts of more than one group: an Organization is a saved look (colors, logo, background) that dresses
          up every Game you run for it, say one for work and one for the neighborhood. To start a Game, use New Game above.
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
    </details>
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
      <Backdrop />
      <section className="card">
        <h2>{org.name}</h2>
        <p className="muted">Its Theme shows on every Game you run for it, unless a Game sets its own.</p>
        <Link to="/">Back to your Games</Link>
      </section>
      <ReadyLooks
        current={{ color: org.color, page: org.page, background: org.backgroundUrl !== null }}
        onPick={async (look, image) => {
          const pictured = await api.setOrgImage(org.id, "background", image);
          update(pictured);
          const colored = pictured && (await api.editOrg(org.id, { color: look.color, page: look.page }));
          update(colored);
          return colored !== undefined;
        }}
      />
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
        />
      </section>
    </div>
  );
}

/**
 * The looks the app comes with, one tap each: its image becomes the background and its two colors are saved with
 * it. The image goes first, so a failed one leaves everything as it was.
 */
export function ReadyLooks({
  current,
  onPick,
}: {
  /** What's in effect, to show which look (if any) it is. */
  current: { color: string | null; page: string | null; background: boolean };
  /** Saves the look; false if that didn't work. */
  onPick: (look: Look, image: File) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const same = (a: string | null, b: string) => a?.toLowerCase() === b.toLowerCase();
  const isCurrent = (look: Look) => current.background && same(current.color, look.color) && same(current.page, look.page);

  // The image is sent like one the Host picks, so it's stored and shown the same way.
  const pick = async (look: Look) => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(look.image);
      if (!res.ok) throw new Error(`${res.status}`);
      const image = new File([await res.arrayBuffer()], `${look.id}.webp`, { type: "image/webp" });
      if (!(await onPick(look, image))) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-label="Ready-made looks">
      <h2>Ready-made looks</h2>
      <p className="muted hint">One tap sets the background and both colors. You can still change any of them below.</p>
      <ul className="looks">
        {LOOKS.map((look) => (
          <li key={look.id}>
            <button type="button" className="look" aria-pressed={isCurrent(look)} disabled={busy} onClick={() => void pick(look)}>
              <img src={look.thumb} alt="" />
              <span className="look-name">
                <span className="look-swatch" style={{ background: look.color }} />
                <span className="look-swatch" style={{ background: look.page }} />
                {look.name}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {failed && (
        <p className="error" role="alert">
          That didn't work. Please try again.
        </p>
      )}
    </section>
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
}: {
  id: string;
  label: string;
  hint?: string;
  alt: string;
  url: string | null;
  removeLabel: string;
  onChange: (file: File | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const change = async (file: File | null) => {
    setBusy(true);
    await onChange(file);
    setBusy(false);
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
      {url && (
        <button type="button" className="link danger" disabled={busy} onClick={() => void change(null)}>
          {removeLabel}
        </button>
      )}
    </div>
  );
}
