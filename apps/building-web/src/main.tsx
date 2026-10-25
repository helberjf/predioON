import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@predioon/ui";
import { App } from "./App.js";
import { TotemScreen } from "./pages/Totem.js";
import "./index.css";

// The totem tablet never starts a user session, not even a silent cookie refresh.
const totem = window.location.pathname === "/totem";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {totem ? <TotemScreen /> : (
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    )}
  </React.StrictMode>,
);
