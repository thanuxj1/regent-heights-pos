import React from "react";
import './index.css';
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthProvider";
import './index.css';

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>
);

// Keeps a copy of the app on the till so it opens with no connection. Only in a
// real build: in development the dev server must always win, or an edit would
// appear not to have taken effect.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      // A till that cannot register one still works — it just needs the network
      // to open. Never worth blocking the app for.
      console.warn("[offline] could not install the offline copy:", err?.message);
    });
  });
}
// // import React from "react";
// // import ReactDOM from "react-dom/client";
// // import App from "./App.jsx";
// // import "./index.css";

// // ReactDOM.createRoot(document.getElementById("root")).render(
// //   <React.StrictMode>
// //     <App />
// //   </React.StrictMode>
// // );
