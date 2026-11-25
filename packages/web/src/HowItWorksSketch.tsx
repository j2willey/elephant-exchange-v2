/**
 * The front page's How it works sketch: a hand-drawn laptop (the Host console), a TV (the scoreboard) and two phones
 * (gifts, 💬 Chat), with arrows from the laptop to the rest. Drawn in SVG so it stays sharp and its words are easy to
 * change. Two layouts of the same drawing: wide (side by side) and tall (stacked, for a phone); CSS shows one. The
 * captions carry no numbers, so they don't compete with the numbered steps below them.
 */
import type { ReactNode } from "react";

const INK = "#2b2b2b";
const RED = "#b3202e";
const SKIN = "#2f2f36";
const PAPER = "#fff4c2";
const PINK = "#fde2e2";

const LABEL = "Sketch: the Host runs the swap from a laptop; every gift and steal shows live on the big screen for the room, and on guests' phones, which are optional, along with 💬 Chat and photos.";

export function HowItWorksSketch() {
  return (
    <div className="how-sketch" role="img" aria-label={LABEL}>
      <svg className="how-sketch-wide" viewBox="0 105 1280 615" aria-hidden="true" {...SVG_PROPS}>
        <Defs id="hw" />
        <Laptop f="hw" />
        <Caption x={250} y={572} anchor="middle" title={["The Host runs it from a laptop"]} lines={["types in each gift as it's opened,", "and who steals what from whom"]} />
        <Tv f="hw" />
        <Caption x={1080} y={170} title={["The room", "watches a TV"]} lines={["every gift, who", "has it, and every", "steal, as it happens"]} />
        <Phones f="hw" />
        <Caption x={995} y={480} title={["Guests can", "follow along"]} note="(phones optional)" lines={["see the gifts and steals,", "trade jokes in 💬 Chat,", "and share photos"]} />
        <Arrow f="hw" d="M458 290 C 520 230, 570 210, 628 225" />
        <Arrow f="hw" d="M458 420 C 530 470, 580 540, 643 560" />
        <ArrowLabel x={530} y={208} angle={-12} text="shows up live" />
        <ArrowLabel x={572} y={478} angle={33} text="and on phones" />
      </svg>
      <svg className="how-sketch-tall" viewBox="0 0 560 1375" aria-hidden="true" {...SVG_PROPS}>
        <Defs id="ht" />
        <g transform="translate(30 -205)">
          <Laptop f="ht" />
        </g>
        <Caption x={280} y={365} anchor="middle" big title={["The Host runs it from a laptop"]} lines={["types in each gift as it's opened,", "and who steals what from whom"]} />
        <Arrow f="ht" d="M280 445 C 270 465, 290 480, 280 500" />
        <ArrowLabel x={300} y={480} text="shows up live" anchor="start" />
        <g transform="translate(-570 390)">
          <Tv f="ht" />
        </g>
        <Caption x={280} y={830} anchor="middle" big title={["The room watches a TV"]} lines={["every gift, who has it, and every steal"]} />
        <Arrow f="ht" d="M280 880 C 270 900, 290 915, 280 935" />
        <ArrowLabel x={300} y={915} text="and on phones" anchor="start" />
        <g transform="translate(-530 505)">
          <Phones f="ht" />
        </g>
        <Caption x={280} y={1258} anchor="middle" big title={["Guests can follow along"]} note="(phones optional)" lines={["see the gifts and steals,", "trade jokes in 💬 Chat, and share photos"]} />
      </svg>
    </div>
  );
}

const SVG_PROPS = {
  xmlns: "http://www.w3.org/2000/svg",
  fill: "none",
  stroke: INK,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** The wobble that makes the lines look hand-drawn, and the arrowhead. `id` keeps the two layouts' ids apart. */
function Defs({ id }: { id: string }) {
  return (
    <defs>
      <filter id={`${id}-rough`} x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves={2} seed={4} />
        <feDisplacementMap in="SourceGraphic" scale={3.5} />
      </filter>
      {/* The arrows' own copy, with room around a short, nearly straight arrow so its head isn't clipped. */}
      <filter id={`${id}-roughArrow`} x="-300%" y="-50%" width="700%" height="200%">
        <feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves={2} seed={4} />
        <feDisplacementMap in="SourceGraphic" scale={3.5} />
      </filter>
      <marker id={`${id}-head`} viewBox="0 0 12 12" refX={10} refY={6} markerWidth={12} markerHeight={12} orient="auto-start-reverse">
        <path d="M1 1 L10 6 L1 11" stroke={RED} strokeWidth={1.8} />
      </marker>
    </defs>
  );
}

type Part = { f: string };

function Laptop({ f }: Part) {
  return (
    <>
      <g filter={`url(#${f}-rough)`} strokeWidth={2.6}>
        <rect x={50} y={225} width={400} height={255} rx={14} fill="#f4f1ea" />
        <rect x={68} y={243} width={364} height={219} rx={4} fill="#fff" />
        <path d="M30 482 L470 482 L500 516 Q500 522 492 522 L8 522 Q0 522 0 516 Z" fill="#e8e3d8" />
        <path d="M205 500 L295 500" strokeWidth={2} />
        <rect x={68} y={243} width={364} height={34} fill={RED} strokeWidth={2} />
        <rect x={84} y={292} width={332} height={32} rx={5} fill={PAPER} strokeWidth={1.8} />
        <rect x={84} y={332} width={332} height={32} rx={5} fill={PINK} strokeWidth={1.8} />
        <rect x={84} y={380} width={150} height={34} rx={8} fill={RED} strokeWidth={2} />
        <rect x={248} y={380} width={100} height={34} rx={8} fill="#fff" strokeWidth={2} />
      </g>
      <g stroke="none" fill={INK} fontSize={19}>
        <text x={84} y={267} fill="#fff" fontWeight={700} fontSize={20}>Host console</text>
        <text x={96} y={314}>Gift 4 opened: Mug ☕ → Ann</text>
        <text x={96} y={354}>Ben steals the Mug from Ann</text>
        <text x={159} y={403} textAnchor="middle" fill="#fff" fontWeight={700}>+ Gift opened</text>
        <text x={298} y={403} textAnchor="middle" fontWeight={700}>Steal</text>
        <text x={84} y={444} fill="#666">Next up: Cara ▶</text>
      </g>
    </>
  );
}

function Tv({ f }: Part) {
  const card = (x: number, y: number, open = true) => (
    <rect x={x} y={y} width={114} height={62} rx={6} fill={open ? PAPER : "#eee"} strokeWidth={1.8} strokeDasharray={open ? undefined : "6 5"} />
  );
  return (
    <>
      <g filter={`url(#${f}-rough)`} strokeWidth={2.6}>
        <rect x={640} y={120} width={420} height={235} rx={10} fill={SKIN} />
        <rect x={654} y={134} width={392} height={207} rx={3} fill="#fff" />
        <path d="M820 355 L800 392 M880 355 L900 392 M780 392 L920 392" strokeWidth={3} />
        <rect x={654} y={134} width={392} height={36} fill={RED} strokeWidth={2} />
        {card(670, 184)}
        {card(793, 184)}
        {card(916, 184)}
        {card(670, 256)}
        {card(793, 256, false)}
        {card(916, 256, false)}
        <rect x={680} y={222} width={80} height={19} rx={9} fill={RED} strokeWidth={1.4} />
      </g>
      <g stroke="none" fill={INK} fontSize={18}>
        <text x={850} y={159} textAnchor="middle" fill="#fff" fontWeight={700} fontSize={21}>Scoreboard</text>
        <text x={678} y={206} fontWeight={700}>☕ Mug</text>
        <text x={774} y={206} textAnchor="end" fill="#555" fontSize={15}>Ben</text>
        <text x={720} y={236} textAnchor="middle" fill="#fff" fontSize={13} fontWeight={700}>stolen 1×</text>
        <text x={803} y={206} fontWeight={700}>🧦 Socks</text>
        <text x={803} y={232} fill="#555" fontSize={16}>Dee</text>
        <text x={926} y={206} fontWeight={700}>🕯️ Candle</text>
        <text x={926} y={232} fill="#555" fontSize={16}>Ann</text>
        <text x={680} y={278} fontWeight={700}>🎲 Game</text>
        <text x={680} y={304} fill="#555" fontSize={16}>Eli</text>
        <text x={850} y={292} textAnchor="middle" fill="#888" fontSize={26}>?</text>
        <text x={973} y={292} textAnchor="middle" fill="#888" fontSize={26}>?</text>
        <text x={850} y={334} textAnchor="middle" fill={RED} fontSize={16} fontWeight={700}>Now up: Cara</text>
      </g>
    </>
  );
}

function Phones({ f }: Part) {
  const row = (y: number) => <rect x={675} y={y} width={100} height={30} rx={5} fill={PAPER} strokeWidth={1.6} />;
  return (
    <>
      <g filter={`url(#${f}-rough)`} strokeWidth={2.6}>
        <rect x={655} y={440} width={140} height={265} rx={20} fill={SKIN} />
        <rect x={665} y={462} width={120} height={222} rx={6} fill="#fff" />
        {row(500)}
        {row(537)}
        {row(574)}
        <rect x={825} y={440} width={140} height={265} rx={20} fill={SKIN} />
        <rect x={835} y={462} width={120} height={222} rx={6} fill="#fff" />
        <rect x={843} y={500} width={104} height={28} rx={12} fill="#e8eefc" strokeWidth={1.6} />
        <rect x={845} y={536} width={100} height={70} rx={6} fill="#dff1e4" strokeWidth={1.6} />
        <path d="M851 598 L875 568 L893 588 L905 576 L939 598" strokeWidth={1.8} />
        <circle cx={925} cy={555} r={8} fill="#ffd54a" strokeWidth={1.6} />
        <rect x={851} y={616} width={98} height={28} rx={12} fill={PINK} strokeWidth={1.6} />
      </g>
      <g stroke="none" fill={INK} fontSize={12}>
        <text x={725} y={488} textAnchor="middle" fontWeight={700} fontSize={16}>🎁 Gifts</text>
        <text x={679} y={520}>☕ Mug · Ben</text>
        <text x={679} y={557}>🧦 Socks · Dee</text>
        <text x={679} y={594}>🕯️ Candle · Ann</text>
        <text x={725} y={636} textAnchor="middle" fill={RED} fontWeight={700} fontSize={14}>Cara's turn!</text>
        <text x={725} y={660} textAnchor="middle" fill="#888">steals left: 2</text>
        <text x={895} y={488} textAnchor="middle" fontWeight={700} fontSize={16}>💬 Chat</text>
        <text x={895} y={519} textAnchor="middle">not the mug again!</text>
        <text x={900} y={635} textAnchor="middle">I want that! ❤️3</text>
      </g>
    </>
  );
}

function Caption(props: {
  x: number;
  y: number;
  title: string[];
  lines: string[];
  note?: string;
  anchor?: "start" | "middle";
  big?: boolean;
}) {
  const { x, anchor = "start", big = false } = props;
  const [titleSize, bodySize] = big ? [32, 25] : [26, 21];
  let y = props.y;
  const out: ReactNode[] = [];
  for (const t of props.title) {
    out.push(<text key={`t${y}`} x={x} y={y} fontSize={titleSize} fontWeight={700} fill={INK}>{t}</text>);
    y += titleSize + 4;
  }
  if (props.note) {
    out.push(<text key="note" x={x} y={y} fontSize={bodySize - 1} fill="#666">{props.note}</text>);
    y += bodySize + 8;
  } else {
    y += 2;
  }
  for (const l of props.lines) {
    out.push(<text key={`l${y}`} x={x} y={y} fontSize={bodySize} fill="#444">{l}</text>);
    y += bodySize + 5;
  }
  return <g stroke="none" textAnchor={anchor}>{out}</g>;
}

function Arrow({ f, d }: Part & { d: string }) {
  return <path filter={`url(#${f}-roughArrow)`} d={d} stroke={RED} strokeWidth={3} markerEnd={`url(#${f}-head)`} />;
}

function ArrowLabel({ x, y, text, angle = 0, anchor = "middle" }: { x: number; y: number; text: string; angle?: number; anchor?: "start" | "middle" }) {
  return (
    <text x={x} y={y} textAnchor={anchor} transform={angle ? `rotate(${angle} ${x} ${y})` : undefined} stroke="none" fill={RED} fontSize={19} fontWeight={700}>
      {text}
    </text>
  );
}
