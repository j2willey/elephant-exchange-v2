import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Api } from "../src/api.js";
import { ApiProvider } from "../src/ApiContext.js";
import { useServerTime } from "../src/Countdown.js";

/** Shows the server's time as this device works it out from a copy of the Game stamped `serverNow`. */
function Probe({ serverNow }: { serverNow: number }) {
  const now = useServerTime(serverNow);
  return <p>{now()}</p>;
}

/** A device whose clock reads `device.ms`, wrong by `off` from the server's. */
function device(off = 0) {
  const d = { ms: 0, api: undefined as unknown as Api };
  d.api = { now: () => d.ms + off } as unknown as Api;
  return d;
}
const shown = () => Number(screen.getByRole("paragraph").textContent);
const showing = (d: ReturnType<typeof device>, serverNow: number) => (
  <ApiProvider api={d.api}>
    <Probe serverNow={serverNow} />
  </ApiProvider>
);

describe("The server's time, on a device", () => {
  it("is right even on a device whose clock is wrong", () => {
    const d = device(-300_000);
    d.ms = 1_000_000;
    render(showing(d, 1_000_000));
    expect(shown()).toBe(1_000_000);
  });

  it("isn't pulled back by a copy of the Game that took a while to arrive", () => {
    const d = device();
    d.ms = 1_000_000;
    const { rerender } = render(showing(d, 1_000_000)); // a copy that arrived at once
    // A copy sent at 1 031 000 that only arrives at 1 051 000: taken at its word, the device would seem 20 s fast.
    d.ms = 1_051_000;
    rerender(showing(d, 1_031_000));
    expect(shown()).toBe(1_051_000);
  });

  it("takes a copy that arrived sooner as the better guide", () => {
    const d = device();
    d.ms = 1_002_000;
    const { rerender } = render(showing(d, 1_000_000)); // 2 s in transit
    d.ms = 1_010_000;
    rerender(showing(d, 1_010_000)); // at once
    d.ms = 1_020_000;
    expect(shown()).toBe(1_010_000); // not yet redrawn
    rerender(showing(d, 1_010_000));
    expect(shown()).toBe(1_020_000);
  });
});
