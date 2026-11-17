import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { createApi } from "./api.js";
import { ApiProvider } from "./ApiContext.js";
import { AppRoutes } from "./App.js";
import "./styles.css";

// The demo page (Demo.tsx) shows the app in frames: the brand heading is left out there, and its sample phone is
// opened with ?demoPlayer=<id>, so it acts as that made-up Player.
if (window.self !== window.top) document.documentElement.dataset.embedded = "";
const demoPlayer = new URLSearchParams(window.location.search).get("demoPlayer") ?? undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ApiProvider api={createApi(undefined, demoPlayer === undefined ? {} : { demoPlayer })}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ApiProvider>
  </StrictMode>,
);
