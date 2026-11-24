import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { BUSY_MESSAGE, ServerBusy, type GameView } from "./api.js";
import { useApi } from "./ApiContext.js";
import { LAPTOP_WIDTH, ScaledFrame, TV_WIDTH } from "./Demo.js";
import type { Bubble, DemoScript } from "./demo-scripts/format.js";
import { createRunner, ScriptError, type Runner } from "./demo-scripts/runner.js";
import { SCRIPTS } from "./demo-scripts/scripts.js";
import { findTarget } from "./demo-scripts/targets.js";
import { useTheme } from "./theme.js";
import { useLiveGame } from "./useLiveGame.js";

/** The guided tour's console frame, which the bubbles point into. */
const CONSOLE_FRAME = "guided-console";

type Tab = "console" | "screen";

/**
 * The guided tour: a written-out swap (a demo script) played on a real demo Game, one speech bubble at a time over the
 * Host console, with the scoreboard and a guest's phone following along. Needs no sign-in, like "Try a demo game".
 */
export function GuidedPage() {
  const { scriptId = "" } = useParams();
  const script = SCRIPTS[scriptId];
  if (!script) {
    return (
      <p className="error">
        There's no guided tour at this link. <Link to="/try">Try a demo game</Link>
      </p>
    );
  }
  return <Guided key={script.id} script={script} />;
}

function Guided({ script }: { script: DemoScript }) {
  const api = useApi();
  const runner = useRef<Runner | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(true);
  /** The bubble shows once the step's actions have landed (after its pauseMs). */
  const [ready, setReady] = useState(false);
  const [broken, setBroken] = useState<string | null>(null);
  const [drift, setDrift] = useState<string | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  const [tab, setTab] = useState<Tab>("console");
  const busyRef = useRef(true);

  const [live, setLive] = useState<GameView | null>(null);
  useTheme(live?.theme);

  /** Runs one thing at a time: Next, Back, a jump or Restart. */
  const go = useCallback(async (what: (r: Runner) => Promise<void>) => {
    const r = runner.current;
    if (!r || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setReady(false);
    try {
      await what(r);
      setBroken(null);
    } catch (e) {
      setAutoplay(false);
      setBroken(e instanceof ScriptError ? `The tour stopped at ${e.message}` : e instanceof ServerBusy ? BUSY_MESSAGE : "The tour couldn't go on. Press ↺ Restart to try again.");
    } finally {
      if (runner.current !== r) return; // the page closed, or its tour started over (React's second mount)
      setGameId(r.gameId());
      setStep(r.step());
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  // A runner for as long as the page is open; leaving deletes its demo Game.
  useEffect(() => {
    const r = createRunner(api, script, {
      onDrift: (stepId, differences) => {
        const said = `${stepId}: ${differences.join("; ")}`;
        if (import.meta.env.DEV) setDrift(said);
        else console.warn(`Guided tour off script at ${said}`);
      },
    });
    runner.current = r;
    busyRef.current = false;
    void go((r) => r.show(0));
    return () => {
      runner.current = null;
      void r.dispose();
    };
  }, [api, script, go]);

  const current = script.steps[step]!;
  const last = step >= script.steps.length - 1;

  // The bubble waits for the live update to land.
  useEffect(() => {
    if (busy) return;
    const t = setTimeout(() => setReady(true), current.pauseMs ?? 600);
    return () => clearTimeout(t);
  }, [busy, current]);

  const next = useCallback(() => void go((r) => r.next()), [go]);
  const show = useCallback((k: number) => void go((r) => r.show(k)), [go]);

  // Autoplay: each bubble stays its holdMs (about 60 ms a character, at least 3 s), then Next.
  useEffect(() => {
    if (!autoplay || !ready || busy) return;
    if (last) {
      setAutoplay(false);
      return;
    }
    const t = setTimeout(next, current.holdMs ?? Math.max(3000, current.bubble.text.length * 60));
    return () => clearTimeout(t);
  }, [autoplay, ready, busy, last, current, next]);

  // → or Space for Next, ← for Back, unless typing or choosing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      // On a button, Space presses that button: leave it be. The arrows still step.
      if (el?.tagName === "BUTTON" && e.key === " ") return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        if (!last) next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (step > 0) show(step - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, show, step, last]);

  const chapter = script.steps.slice(0, step + 1).reverse().find((s) => s.chapter)?.chapter;
  const phonePlayer = live?.players[0];

  return (
    <div className="guided">
      <header className="guided-head">
        <h1>▶ {script.title}</h1>
        <p className="muted">{script.summary}</p>
      </header>

      <nav className="guided-controls card" aria-label="Guided tour">
        <button className="secondary" onClick={() => show(step - 1)} disabled={busy || step === 0}>
          ◀ Back
        </button>
        <button onClick={next} disabled={busy || last || broken !== null} aria-busy={busy}>
          {busy ? <span className="guided-spinner" aria-label="Working" /> : null} Next ▶
        </button>
        <button className="secondary" onClick={() => setAutoplay((a) => !a)} disabled={last || broken !== null} aria-pressed={autoplay}>
          {autoplay ? "⏸ Pause" : "⏯ Autoplay"}
        </button>
        <button className="secondary" onClick={() => show(0)} disabled={busy}>
          ↺ Restart
        </button>
        <span className="guided-count" aria-live="polite">
          {step + 1} / {script.steps.length}
          {chapter ? ` · ${chapter}` : ""}
        </span>
        <label className="guided-jump">
          <select aria-label="Go to step" value={step} disabled={busy} onChange={(e) => show(Number(e.target.value))}>
            {script.steps.map((s, i) => (
              <option key={s.id} value={i}>
                {i + 1}. {s.chapter ? `${s.chapter}: ` : ""}
                {s.bubble.text.length > 60 ? `${s.bubble.text.slice(0, 57)}…` : s.bubble.text}
              </option>
            ))}
          </select>
        </label>
        {broken && (
          <p className="error" role="alert">
            {broken}
          </p>
        )}
        {drift && (
          <p className="error guided-drift" role="alert">
            Off script at {drift}
          </p>
        )}
        <p className="muted hint">
          You can press the console's own buttons between steps, though that may take the swap off script. ↺ Restart puts it back.
        </p>
      </nav>
      {gameId && <Follow key={gameId} id={gameId} onGame={setLive} />}
      <div className="demo">
        <section className="demo-main" aria-label="Host">
          <div className="demo-tabs" role="tablist">
            {(
              [
                ["console", "Host console"],
                ["screen", "Live scoreboard"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" id={`guided-tab-${id}`} aria-selected={tab === id} aria-controls={`guided-${id}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="guided-stage">
            {gameId ? (
              <>
                <ScaledFrame key={`c-${gameId}`} width={LAPTOP_WIDTH} id={CONSOLE_FRAME} role="tabpanel" aria-labelledby="guided-tab-console" title="Host console" src={`/games/${gameId}`} hidden={tab !== "console"} />
                <ScaledFrame key={`s-${gameId}`} width={TV_WIDTH} id="guided-screen" role="tabpanel" aria-labelledby="guided-tab-screen" title="Live scoreboard" src={`/games/${gameId}/screen`} hidden={tab !== "screen"} />
              </>
            ) : (
              <div className="scaled-frame guided-loading">
                <p className="muted">Setting up the swap…</p>
              </div>
            )}
            {gameId && ready && !broken && (
              <BubbleLayer
                key={`${gameId}-${step}`}
                bubble={current.bubble}
                onConsole={tab === "console"}
                names={{
                  giftLabel: (key) => {
                    const id = runner.current?.giftId(key);
                    return id === undefined ? undefined : live?.gifts.find((g) => g.id === id)?.name;
                  },
                  postId: (ref) => runner.current?.postId(ref),
                }}
              />
            )}
          </div>
        </section>

        <section className="demo-phone" aria-label="Phone">
          {phonePlayer && gameId ? (
            <>
              <p className="muted">{phonePlayer.name}'s phone (guests can follow along if they like)</p>
              <iframe key={gameId} title={`${phonePlayer.name}'s phone`} src={`/games/${gameId}?demoPlayer=${encodeURIComponent(phonePlayer.id)}`} />
            </>
          ) : null}
        </section>
      </div>

    </div>
  );
}

/**
 * Follows one demo Game live. Keyed by the Game: a rebuilt Game starts over at a lower version, which the same hook
 * would take for an older copy of the last one.
 */
function Follow({ id, onGame }: { id: string; onGame: (game: GameView | null) => void }) {
  const [game] = useLiveGame(id);
  useEffect(() => onGame(game === "loading" ? null : game), [game, onGame]);
  return null;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Side = "above" | "below" | "left" | "right";

/**
 * The bubble and a ring around its target, drawn over the console frame at full size (not inside the shrunk frame,
 * so the words stay readable). Follows the target as the console changes, scrolls or resizes.
 */
function BubbleLayer({ bubble, onConsole, names }: { bubble: Bubble; onConsole: boolean; names: Parameters<typeof findTarget>[2] }) {
  const layer = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [ring, setRing] = useState<Box | null>(null);
  const [spot, setSpot] = useState<{ left: number; top: number; side: Side | null; arrow: number } | null>(null);
  const namesRef = useRef(names);
  namesRef.current = names;

  useEffect(() => {
    let scrolled = false;
    let watching: Document | null = null;
    let frameId = 0;
    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => schedule());

    function schedule() {
      if (frameId) return;
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        place();
      });
    }

    function place() {
      const stage = layer.current?.getBoundingClientRect();
      const size = card.current ? { w: card.current.offsetWidth, h: card.current.offsetHeight } : { w: 320, h: 80 };
      if (!stage) return;
      const iframe = document.getElementById(CONSOLE_FRAME) as HTMLIFrameElement | null;
      const doc = onConsole ? iframe?.contentDocument : null;
      if (doc && doc !== watching) {
        observer?.disconnect();
        observer?.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        doc.addEventListener("scroll", schedule, true);
        watching = doc;
        scrolled = false;
      }
      const el = iframe && doc ? findTarget(doc, bubble.target, namesRef.current) : null;
      if (!iframe || !el || el.getClientRects().length === 0) {
        if (bubble.target !== "center" && import.meta.env.DEV && doc?.readyState === "complete") console.warn(`Guided tour: ${bubble.target} isn't on the console`);
        setRing(null);
        setSpot({ left: (stage.width - size.w) / 2, top: Math.max(16, (stage.height - size.h) / 2), side: null, arrow: 0 });
        return;
      }
      // Into view inside the frame, once per step, without scrolling the page around it.
      const inner = iframe.contentWindow;
      let r = el.getBoundingClientRect();
      if (!scrolled && inner && (r.top < 0 || r.bottom > inner.innerHeight)) {
        const { scrollX, scrollY } = window;
        el.scrollIntoView({ block: "center", inline: "nearest" });
        window.scrollTo(scrollX, scrollY);
        r = el.getBoundingClientRect();
      }
      scrolled = true;
      const frame = iframe.getBoundingClientRect();
      const scale = iframe.offsetWidth > 0 ? frame.width / iframe.offsetWidth : 1;
      const box: Box = { left: frame.left - stage.left + r.left * scale, top: frame.top - stage.top + r.top * scale, width: r.width * scale, height: r.height * scale };
      setRing(box);
      setSpot(placeBubble(box, size, { width: stage.width, height: stage.height }, bubble.placement ?? "auto"));
    }

    place();
    const timer = setInterval(place, 400); // a safety net for changes nothing announces (an image loading)
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      clearInterval(timer);
      if (frameId) cancelAnimationFrame(frameId);
      observer?.disconnect();
      watching?.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [bubble, onConsole]);

  return (
    <div ref={layer} className="guided-layer" aria-hidden={false}>
      {ring && <div className="guided-ring" style={{ left: ring.left - 4, top: ring.top - 4, width: ring.width + 8, height: ring.height + 8 }} />}
      <div
        ref={card}
        role="status"
        aria-live="polite"
        className={`guided-bubble${spot?.side ? ` guided-bubble-${spot.side}` : ""}`}
        style={spot ? { left: spot.left, top: spot.top, ["--arrow" as string]: `${spot.arrow}px` } : { visibility: "hidden" }}
      >
        {bubble.text}
      </div>
    </div>
  );
}

const GAP = 14;
const MARGIN = 8;

/** Where the bubble goes beside its target: the side asked for if it fits, else the first that does; and its arrow. */
export function placeBubble(target: Box, size: { w: number; h: number }, stage: { width: number; height: number }, placement: "auto" | Side) {
  const cx = target.left + target.width / 2;
  const cy = target.top + target.height / 2;
  const clampX = (x: number) => Math.max(MARGIN, Math.min(stage.width - size.w - MARGIN, x));
  const clampY = (y: number) => Math.max(MARGIN, Math.min(stage.height - size.h - MARGIN, y));
  const at: Record<Side, { left: number; top: number; fits: boolean }> = {
    below: { left: clampX(cx - size.w / 2), top: target.top + target.height + GAP, fits: target.top + target.height + GAP + size.h <= stage.height - MARGIN },
    above: { left: clampX(cx - size.w / 2), top: target.top - GAP - size.h, fits: target.top - GAP - size.h >= MARGIN },
    right: { left: target.left + target.width + GAP, top: clampY(cy - size.h / 2), fits: target.left + target.width + GAP + size.w <= stage.width - MARGIN },
    left: { left: target.left - GAP - size.w, top: clampY(cy - size.h / 2), fits: target.left - GAP - size.w >= MARGIN },
  };
  const order: Side[] = [...(placement === "auto" ? [] : [placement]), "below", "above", "right", "left"];
  const side = order.find((s) => at[s].fits) ?? "below";
  const { left, top } = at[side];
  const y = Math.max(MARGIN, Math.min(stage.height - size.h - MARGIN, top));
  // The arrow sits on the edge facing the target, as near its middle as the bubble allows.
  const arrow = side === "below" || side === "above" ? Math.max(16, Math.min(size.w - 16, cx - left)) : Math.max(14, Math.min(size.h - 14, cy - y));
  return { left, top: y, side, arrow };
}
