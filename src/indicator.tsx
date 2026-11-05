import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/motion.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ComputerIndicator } from "./features/computer/ComputerIndicator.tsx";
import { follow_remembered_language } from "./i18n/index.ts";
import { init_computer } from "./state/computer.ts";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root element");
}

follow_remembered_language();
init_computer();

createRoot(root).render(
  <StrictMode>
    <ComputerIndicator />
  </StrictMode>,
);
