import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login as apiLogin, setAuthToken, getCurrentUser, getUserCapabilities } from "../services/api";
import { connectSocket, disconnectSocket } from "../services/socket";
import { AuthContext } from "./AuthContext";

function tokenPayload(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part));
  } catch {
    return null;
  }
}

/**
 * The sign-in as this browser holds it — the token and the person together, and
 * still valid — or nobody.
 *
 * A token past its expiry is no sign-in at all: starting from one opened the
 * screens as that person and then failed on the first request. A token and a
 * person that do not belong together are caught mid-write by another tab and
 * are not a sign-in either (null: wait for the rest).
 */
function readSession() {
  const token = localStorage.getItem("token");
  let user = null;
  try {
    user = getCurrentUser();
  } catch {
    user = null;
  }
  if (!token || !user) return { token: null, user: null };

  const payload = tokenPayload(token);
  if (!payload || (payload.exp && payload.exp < Date.now() / 1000)) return { token: null, user: null };
  if (payload.u_id != null && user.u_id != null && Number(payload.u_id) !== Number(user.u_id)) return null;

  return { token, user };
}

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [session, setSession] = useState(() => readSession() ?? { token: null, user: null });
  const { user, token } = session;
  const [capabilities, setCapabilities] = useState(() => new Set());
  // Starts false so a capability-gated route doesn't decide (and redirect
  // away) on the empty Set that exists before the first fetch resolves —
  // ProtectedRoute waits on this instead of racing the request.
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);

  // The permissions the signed-in person was personally granted — independent
  // of their role, and used to decide whether to show them a role-crossing
  // link (e.g. a POS terminal a manager handed a waiter). Fetched, never
  // baked into the token, so a revoke takes effect without a re-login.
  const refreshCapabilities = useCallback(async () => {
    if (!user?.u_id) { setCapabilities(new Set()); setCapabilitiesLoaded(true); return; }
    try {
      const data = await getUserCapabilities(user.u_id);
      setCapabilities(new Set(data?.capabilities || []));
    } catch {
      setCapabilities(new Set());
    } finally {
      setCapabilitiesLoaded(true);
    }
  }, [user?.u_id]);

  useEffect(() => {
    setCapabilitiesLoaded(false);
    if (user?.u_id) refreshCapabilities();
    else setCapabilitiesLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.u_id]);

  // Whatever is left of an expired or half-written sign-in is cleared once.
  useEffect(() => {
    if (!session.token) {
      setAuthToken(null);
      localStorage.removeItem("user");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (token) setAuthToken(token);
  }, [token]);

  // Every tab of this browser shares one sign-in: it lives in localStorage.
  // When another tab signs in as someone else or signs out, this tab follows at
  // once. It used to go on showing the old person while its requests and live
  // updates quietly went out as the new one.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== null && e.key !== "token" && e.key !== "user") return;
      const next = readSession();
      if (!next) return;
      setSession((prev) =>
        prev.token === next.token && Number(prev.user?.u_id) === Number(next.user?.u_id) ? prev : next,
      );
      if (next.token) {
        setAuthToken(next.token);
        connectSocket();
      } else {
        setAuthToken(null);
        disconnectSocket();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const login = async (credentials) => {
    const data = await apiLogin(credentials); // expects { token, user }
    if (!data?.token) throw new Error("No token returned");
    // The person first, the token last: other tabs switch when the token lands.
    localStorage.setItem("user", JSON.stringify(data.user));
    setAuthToken(data.token);
    setSession({ token: data.token, user: data.user });
    return data;
  };

  const logout = () => {
    // The token goes first, so every other tab signs out on it.
    setAuthToken(null);
    localStorage.removeItem("user");
    disconnectSocket();
    setSession({ token: null, user: null });
    navigate("/login");
  };

  return (
    <AuthContext.Provider value={{ user, token, capabilities, capabilitiesLoaded, refreshCapabilities, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
