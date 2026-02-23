const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('./config');

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

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error('Manglende token'));
    }
    try {
      const payload = jwt.verify(token, config.jwtSecret);
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
