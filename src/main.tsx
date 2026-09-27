import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App bgApi={import.meta.env.VITE_BG_API} captionsTokenApi={import.meta.env.VITE_CAPTIONS_TOKEN_API} />
  </StrictMode>,
);
