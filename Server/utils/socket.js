import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { ROLES } from "../middleware/authMiddleware.js";
import { corsOrigin, describeCorsOrigin } from "../config/env.js";

let io;

const BRANCH_UPDATE_ROOM = "branch-updates";

export const getBranchSocketRoom = (b_id) => `branch:${b_id}`;
// Each property's kitchen has a room of its own. It was one room for the whole
// platform, so every hotel's kitchen screens heard every other hotel's orders.
export const getKitchenSocketRoom = (b_id) => `kitchen:${b_id}`;
export const getCompanySocketRoom = (com_id) => `company:${com_id}`;

export const getCashierSocketRoom = (userId) => `cashier-updates:${userId}`;

function extractSocketToken(socket) {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.length > 0) {
    return authToken;
  }

  const queryToken = socket.handshake.query?.token;
  if (typeof queryToken === "string" && queryToken.length > 0) {
    return queryToken;
  }

  const headerToken = socket.handshake.headers?.authorization;
  if (typeof headerToken === "string" && headerToken.length > 0) {
    return headerToken.startsWith("Bearer ") ? headerToken.slice(7) : headerToken;
  }

  return null;
}

export const initializeSocket = (httpServer) => {
  if (io) {
    return io;
  }

  io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = extractSocketToken(socket);

      if (!token) {
        return next(new Error("Unauthorized socket connection."));
      }

      if (!process.env.JWT_SECRET) {
        return next(new Error("JWT_SECRET is not configured."));
      }

      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      return next();
    } catch (error) {
      return next(new Error("Unauthorized socket connection."));
    }
  });

  console.log("✓ Socket.IO ready — browser callers allowed:", describeCorsOrigin());

  io.on("connection", (socket) => {
    const roleId = Number(socket.user?.role_id);

    // The platform-wide room carries every property's records, so only the
    // platform's own staff sit in it. Hotel administrators used to join it too,
    // and were sent other companies' properties as they were added or edited.
    if (roleId === ROLES.SUPER_ADMIN) {
      socket.join(BRANCH_UPDATE_ROOM);
    }

    // Branch-isolated rooms: BRANCH_ADMIN joins its own branch room
    if (roleId === ROLES.BRANCH_ADMIN && socket.user?.b_id) {
      socket.join(getBranchSocketRoom(socket.user.b_id));
    }

    // Company-isolated rooms: ADMIN joins its company room (sees all branches in company)
    if (roleId === ROLES.ADMIN && socket.user?.com_id) {
      socket.join(getCompanySocketRoom(socket.user.com_id));
    }

    if (roleId === ROLES.CASHIER && socket.user?.u_id) {
      socket.join(getCashierSocketRoom(socket.user.u_id));
    }

    // Waiters join the same personal room pattern so order:ready reaches them
    if (roleId === ROLES.WAITER && socket.user?.u_id) {
      socket.join(getCashierSocketRoom(socket.user.u_id));
    }

    // Front-desk staff also watch their own branch, so the room rack and calendar
    // repaint when a colleague checks someone in or raises a room-service order.
    if (
      [ROLES.CASHIER, ROLES.WAITER, ROLES.KITCHEN_STAFF].includes(roleId) &&
      socket.user?.b_id
    ) {
      socket.join(getBranchSocketRoom(socket.user.b_id));
    }

    if (roleId === ROLES.KITCHEN_STAFF && socket.user?.b_id) {
      socket.join(getKitchenSocketRoom(socket.user.b_id));
    }

    socket.emit("socket:ready", {
      message: "WebSocket connection established",
      socketId: socket.id,
    });

    socket.on("socket:ping", (payload, acknowledgement) => {
      const response = {
        ok: true,
        timestamp: new Date().toISOString(),
        payload: payload ?? null,
      };

      if (typeof acknowledgement === "function") {
        acknowledgement(response);
        return;
      }

      socket.emit("socket:pong", response);
    });
  });

  return io;
};

export const getSocketIO = () => {
  if (!io) {
    throw new Error("Socket.IO has not been initialized yet.");
  }

  return io;
};

export const emitSocketEvent = (eventName, payload, options = {}) => {
  if (!io) {
    return false;
  }

  // Debug logging when not in production
  if (process.env.NODE_ENV !== "production") {
    try {
      const roomInfo = options.room ? ` to room=${options.room}` : " to all";
      // Which event went where — not the payload, which is whole orders.
      // eslint-disable-next-line no-console
      console.log(`Socket emit -> ${eventName}${roomInfo}`);
    } catch (e) {
      // ignore logging errors
    }
  }

  if (options.room) {
    io.to(options.room).emit(eventName, payload);
    return true;
  }

  io.emit(eventName, payload);
  return true;
};

export const BRANCH_SOCKET_ROOM = BRANCH_UPDATE_ROOM;

// A property's company, remembered for a while. Every order event asked the
// database afresh, which in a busy service was one more query for every dish.
const companyCache = new Map();
async function companyOf(b_id) {
  const hit = companyCache.get(b_id);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.com_id;
  const { default: pool } = await import("../config/database.js");
  const { rows } = await pool.query('SELECT com_id FROM "Branch" WHERE "B_id" = $1', [b_id]);
  const com_id = rows[0]?.com_id ?? null;
  companyCache.set(b_id, { com_id, at: Date.now() });
  return com_id;
}

export const emitOrderEvent = async (eventName, order) => {
  if (!io || !order) return false;
  const b_id = order.b_id;
  if (b_id) {
    io.to(getBranchSocketRoom(b_id)).emit(eventName, order);
    // Look up company and emit to company room
    try {
      const com_id = await companyOf(b_id);
      if (com_id) {
        io.to(getCompanySocketRoom(com_id)).emit(eventName, order);
      }
    } catch { /* non-critical */ }
  }
  return true;
};