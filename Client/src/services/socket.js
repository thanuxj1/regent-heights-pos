import { io } from "socket.io-client";
import { SOCKET_URL } from "../config";


let socket;

export const getSocket = () => {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      auth: {
        token: localStorage.getItem("token") || null,
      },
    });

    if (import.meta.env.MODE !== "production") {
      socket.on("connect", () => {
        console.debug("socket connected", socket.id);
      });

      socket.on("disconnect", (reason) => {
        console.debug("socket disconnected", reason);
      });

      socket.on("connect_error", (err) => {
        console.debug("socket connect_error", err.message || err);
      });

      socket.onAny((event, ...args) => {
        console.debug("socket event received", event, args);
      });
    }
  }

  return socket;
};

/**
 * Connect as whoever is signed in now.
 *
 * If the socket is connected as someone else — a sign-out and a different
 * sign-in, here or in another tab — it reconnects, so the server seats it in
 * the new person's rooms. It used to stay connected as the first person, and a
 * screen went on hearing (and missing) events meant for someone else. The same
 * socket is reused, so the screens' listeners stay attached.
 */
export const connectSocket = () => {
  const activeSocket = getSocket();
  const token = localStorage.getItem("token") || null;
  const switched = (activeSocket.auth?.token ?? null) !== token;

  activeSocket.auth = { token };

  if (switched && activeSocket.active) {
    activeSocket.disconnect();
  }
  if (!activeSocket.connected && token) {
    activeSocket.connect();
  }

  return activeSocket;
};

export const disconnectSocket = () => {
  if (!socket) {
    return;
  }

  socket.disconnect();
  socket = undefined;
};

export const getSocketUrl = () => SOCKET_URL;
