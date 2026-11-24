/**
 * Plays a demo script through the real rules module (no server, no browser) with its scripted Draws, and checks every
 * step's `expect`. A quick way to catch a script that the rules would refuse.
 *
 *   node --experimental-strip-types demo-script/check-script.ts demo-script/scripts/happy-path.json
 *
 * Posts, Reactions, Pitches and screen switches aren't game moves, so they're skipped here. The replay's own
 * validator (see prompts/build-replay.md) should replace this throwaway once it exists.
 */
import { newGame, decide, evolve, gifts as giftsOf, type Command } from "../packages/rules/src/index.ts";
import { readFileSync } from "node:fs";
const s = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const pid: Record<string,string> = {}; for (const n of s.players) pid[n] = "p-"+n;
const nameOf = (id: string) => id.slice(2);
const gid = (k: string) => "g-"+k;
let draws = [...s.draws];
const draw = (c: string[]) => { const n = draws.shift(); if (!n || !c.includes(pid[n])) throw new Error(`draw ${n} not in ${c.map(nameOf)}`); return pid[n]; };
let st = newGame({ activeSlots: s.game.options.activeSlots, maxSteals: s.game.options.maxSteals });
const send = (c: Command) => { const r = decide(st, c, draw); if (!Array.isArray(r)) throw new Error(JSON.stringify(r)); st = r.reduce(evolve, st); };
for (const n of s.players) send({ type: "AddPlayer", playerId: pid[n], name: n });
const arr = (v: any) => v === undefined ? undefined : Array.isArray(v) ? v : v === "" ? [] : [v];
for (const step of s.steps) {
  for (const a of step.actions ?? []) {
    const g = s.gifts[a.gift];
    switch (a.do) {
      case "startGame": send({ type: "StartGame" }); break;
      case "open": send({ type: "OpenGift", playerId: pid[a.player], giftId: gid(a.gift), name: a.unnamed ? "" : g.name, ...(a.unnamed||!g.description ? {} : { description: g.description }) }); break;
      case "describe": send({ type: "DescribeGift", giftId: gid(a.gift), name: g.name, description: g.description ?? "" }); break;
      case "steal": send({ type: "Steal", playerId: pid[a.player], giftId: gid(a.gift) }); break;
      case "skip": send({ type: "Skip", playerId: pid[a.player] }); break;
      case "startFinalRound": send({ type: "StartFinalRound", finalists: a.finalists, leftoverGifts: a.leftoverGifts }); break;
      case "keep": send({ type: "KeepGift", playerId: pid[a.player] }); break;
      case "takeReturned": send({ type: "TakeReturnedGift", playerId: pid[a.player], giftId: gid(a.gift) }); break;
      case "endGame": send({ type: "EndGame" }); break;
    }
  }
  const e = step.expect; const errs: string[] = [];
  if (e) {
    const gs = giftsOf(st);
    if (e.phase && st.phase !== e.phase) errs.push(`phase ${st.phase}`);
    const up = arr(e.up); if (up && JSON.stringify(st.active.map(nameOf)) !== JSON.stringify(up)) errs.push(`up ${st.active.map(nameOf)}`);
    const od = arr(e.onDeck); if (od && JSON.stringify(st.onDeck.map(nameOf)) !== JSON.stringify(od)) errs.push(`onDeck ${st.onDeck.map(nameOf)}`);
    for (const [k,h] of Object.entries(e.holders ?? {})) { const g = gs.find(x=>x.id===gid(k)); const got = g ? (g.holderId===null?null:nameOf(g.holderId)) : "unopened"; if (got !== h) errs.push(`${k} held by ${got}`); }
    for (const k of e.frozen ?? []) if (!gs.find(x=>x.id===gid(k))?.frozen) errs.push(`${k} not frozen`);
    for (const [k,n] of Object.entries(e.steals ?? {})) { const g = gs.find(x=>x.id===gid(k)); if (g?.steals !== n) errs.push(`${k} steals ${g?.steals}`); }
    if (e.leftoverGifts !== undefined && st.leftoverGifts !== e.leftoverGifts) errs.push(`leftover ${st.leftoverGifts}`);
  }
  console.log(step.id.padEnd(24), errs.length ? "FAIL "+errs.join("; ") : "ok", "| up", st.active.map(nameOf).join(","), "deck", st.onDeck.map(nameOf).join(","));
}
console.log("draws left:", draws, "final:", giftsOf(st).map(g => `${g.name}=${g.holderId?nameOf(g.holderId):"table"}${g.frozen?"*":""}`).join(", "));
