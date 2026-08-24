import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BrandingProvider } from "./context/BrandingContext";
import "./styles/global.css";
// React Flow's STRUCTURAL half only (base.css, not style.css): the geometry the
// canvas cannot work without, none of the library's default theme. Every
// selector it ships is scoped under `.react-flow`, so it cannot reach the rest
// of the module; gold.css repaints it through the library's own `--xy-*`
// properties.
import "@xyflow/react/dist/base.css";
// The visual layer, last so it wins the cascade. Removing this one line reverts
// the module to its base appearance — that is the whole rollback contract.
import "./styles/gold.css";

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
