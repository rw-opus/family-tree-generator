import React from "react";
import { createRoot } from "react-dom/client";
import { AppEntry } from "./AppEntry.jsx";
import "./styles.css";
import "./calculator.css";
import "./workbench.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppEntry />
  </React.StrictMode>,
);
