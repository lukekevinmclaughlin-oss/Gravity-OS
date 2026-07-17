import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";

// Apply the last resolved appearance before React mounts to avoid a first-frame flash.
try {
  const stored = JSON.parse(localStorage.getItem("gravity.appearance") ?? "null") as
    | { resolved?: "light" | "dark" }
    | null;
  if (stored?.resolved === "light") document.documentElement.dataset.theme = "daybreak";
  document.documentElement.style.colorScheme = stored?.resolved ?? "dark";
} catch {
  document.documentElement.style.colorScheme = "dark";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
