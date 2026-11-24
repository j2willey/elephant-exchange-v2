import { useEffect, useRef, useState } from "react";
import type { StatsSummary } from "./api.js";

type VisitorDay = StatsSummary["visitors"][number];

const date = (day: string, options: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", ...options });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Where the day's visitors first landed, in words, for the tooltip. */
function landings(d: VisitorDay): string {
  const parts = [
    [d.front, "front page"],
    [d.demo, "demo"],
    [d.game, "a Game's link"],
    [d.other, "other pages"],
  ] as const;
  return parts.filter(([n]) => n > 0).map(([n, where]) => `${n} ${where}`).join(", ");
}

/** A round top for the axis: the smallest of 1, 2, 5 × a power of ten at or above the busiest day (at least 4). */
function niceTop(max: number): number {
  const at = Math.max(4, max);
  const power = 10 ** Math.floor(Math.log10(at));
  return [1, 2, 5, 10].map((m) => m * power).find((v) => v >= at)!;
}

const W = 560;
const H = 180;
const LEFT = 28;
const BOTTOM = 22;
const TOP = 14;

/**
 * Unique visitors a day over the last 14 days, as bars (one series, so no legend: the title names it), with a
 * tooltip per day and the same numbers in a table below. Counted without tracking anyone (the server's visitors.ts).
 */
export function Visitors({ days }: { days: VisitorDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // On a phone, where the chart scrolls sideways, it opens at the newest days.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  const top = niceTop(Math.max(0, ...days.map((d) => d.visitors)));
  const plotH = H - TOP - BOTTOM;
  const slot = (W - LEFT) / days.length;
  const barW = Math.min(28, slot - 6);
  const y = (n: number) => TOP + plotH - (n / top) * plotH;
  const today = days.at(-1);
  const total = days.reduce((n, d) => n + d.visitors, 0);
  const shown = hover === null ? null : days[hover]!;

  return (
    <section className="card" aria-label="Visitors">
      <h2>Visitors</h2>
      <p className="muted hint">
        Different visitors a day, each counted once however many pages they open, without a cookie or anything that
        identifies them (so someone who comes back tomorrow counts again). Your own visits as admin don't count. Link
        previews (LinkedIn, Facebook, Slack…) and search engines are counted apart. Days run midnight to midnight UTC
        (4 pm to 4 pm Pacific).
      </p>
      <dl className="stat-tiles">
        <div>
          <dt>Today (UTC)</dt>
          <dd>{today?.visitors ?? 0}</dd>
        </div>
        <div>
          <dt>Last 14 days</dt>
          <dd>{total}</dd>
        </div>
        <div>
          <dt>From your links</dt>
          <dd>{days.reduce((n, d) => n + d.fromLinks, 0)}</dd>
        </div>
        <div>
          <dt>Link previews</dt>
          <dd>{days.reduce((n, d) => n + d.previews, 0)}</dd>
        </div>
      </dl>

      <div className="visitor-scroll" ref={scroller}>
      <div className="visitor-chart" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Unique visitors per day, last 14 days: ${plural(today?.visitors ?? 0, "visitor")} today, ${total} in all`}>
          {[0, top / 2, top].map((v) => (
            <g key={v} className="visitor-grid">
              <line x1={LEFT} x2={W} y1={y(v)} y2={y(v)} />
              <text x={LEFT - 6} y={y(v) + 4} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const x = LEFT + i * slot + (slot - barW) / 2;
            const h = TOP + plotH - y(d.visitors);
            const r = Math.min(4, h / 2);
            const base = TOP + plotH;
            const isToday = i === days.length - 1;
            return (
              <g key={d.day}>
                {/* Rounded at the top, square on the baseline. */}
                <path
                  data-testid="visitor-bar"
                  className={hover === i ? "visitor-bar active" : "visitor-bar"}
                  d={
                    d.visitors === 0
                      ? `M${x},${base}h${barW}`
                      : `M${x},${base}V${base - h + r}q0,-${r} ${r},-${r}h${barW - 2 * r}q${r},0 ${r},${r}V${base}Z`
                  }
                />
                {(isToday || hover === i) && d.visitors > 0 && (
                  <text className="visitor-value" x={x + barW / 2} y={base - h - 4} textAnchor="middle">
                    {d.visitors}
                  </text>
                )}
                <text className="visitor-day" x={x + barW / 2} y={H - 6} textAnchor="middle">
                  {i === 0 || d.day.endsWith("-01") ? date(d.day, { month: "short", day: "numeric" }) : date(d.day, { day: "numeric" })}
                </text>
                {/* The whole column is the hover target, not just the bar. */}
                <rect x={LEFT + i * slot} y={0} width={slot} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
        {shown && hover !== null && (
          <div className="visitor-tip" style={{ left: `${((LEFT + (hover + 0.5) * slot) / W) * 100}%` }} role="status">
            <strong>{date(shown.day, { weekday: "short", month: "short", day: "numeric" })}</strong>
            <span>{plural(shown.visitors, "visitor")}</span>
            {shown.visitors > 0 && <span className="muted">First landed on: {landings(shown)}</span>}
            {shown.fromLinks > 0 && <span className="muted">{shown.fromLinks} from your links</span>}
            {shown.previews > 0 && <span className="muted">{plural(shown.previews, "link preview")}</span>}
          </div>
        )}
      </div>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Visitors</th>
              <th>Front page</th>
              <th>Demo</th>
              <th>A Game's link</th>
              <th>Other</th>
              <th>From your links</th>
              <th>Link previews</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.day}>
                <td>{date(d.day, { weekday: "short", month: "short", day: "numeric" })}</td>
                <td>{d.visitors}</td>
                <td>{d.front}</td>
                <td>{d.demo}</td>
                <td>{d.game}</td>
                <td>{d.other}</td>
                <td>{d.fromLinks}</td>
                <td>{d.previews}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
