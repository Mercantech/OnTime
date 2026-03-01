const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { pool } = require('./db');

/**
 * Attach Socket.IO to HTTP server with JWT auth.
 * On connection: verify token from handshake.auth.token, set socket.userId.
 * Export io and helper to get io from app if needed.
 */
function attachSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true },
    path: '/socket.io',
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error('Manglende token'));
    }
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      if (payload.jti) {
        const r = await pool.query(
          'SELECT 1 FROM login_sessions WHERE jti = $1 AND revoked_at IS NULL',
          [payload.jti]
        );
        if (r.rows.length === 0) {
          return next(new Error('Session deaktiveret'));
        }
      }
      socket.userId = payload.userId;
      socket.userEmail = payload.email;
      next();
    } catch {
      next(new Error('Ugyldig eller udløbet token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: userId=${socket.userId}`);
    socket.on('disconnect', (reason) => {
      console.log(`Socket disconnected: userId=${socket.userId}, reason=${reason}`);
    });
  });

  return io;
}

module.exports = { attachSocket };
