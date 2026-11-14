import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { createApi } from "./api.js";
import { ApiProvider } from "./ApiContext.js";
import { AppRoutes } from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ApiProvider api={createApi()}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ApiProvider>
  </StrictMode>,
);
