import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BrandingProvider } from "./context/BrandingContext";
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) throw new Error("No se encontró el contenedor #root");

createRoot(container).render(
  // Whitelabel first: the tenant decides the colours, the name and whether
  // there is an app to render at all.
  <StrictMode>
    <BrandingProvider>
      <App />
    </BrandingProvider>
  </StrictMode>,
);
