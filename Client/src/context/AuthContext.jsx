import { createContext, useContext } from "react";

// Only the context and its hook live here; the provider is AuthProvider.jsx.
//
// This file used to carry a second, unused provider that imported the API and
// socket modules. Every edit to either one re-ran this file in development and
// minted a fresh context, which could leave a screen reading one context while
// the provider fed another. Nothing here imports anything that changes.
export const AuthContext = createContext(null);

const SIGNED_OUT = {
  user: null,
  token: null,
  capabilities: new Set(),
  capabilitiesLoaded: true,
  refreshCapabilities: () => {},
  login: async () => {
    throw new Error("Sign-in is not ready yet. Reload the page.");
  },
  logout: () => {},
};

/** The signed-in person, or a signed-out stand-in outside the provider. */
export const useAuth = () => useContext(AuthContext) ?? SIGNED_OUT;
