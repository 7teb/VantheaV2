import "@fontsource-variable/inter/wght.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/motion.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { init_state } from "./state/index.ts";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root element");
}

init_state();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
