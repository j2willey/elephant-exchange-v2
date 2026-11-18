import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Every test file runs a real server, all in parallel: under that load a save and a re-read can take over the
// default 1s. Waits still end as soon as what they wait for appears, so passing tests are no slower.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => cleanup());
