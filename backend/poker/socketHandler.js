const { pool } = require('../db');
const { createTableState, startHand, applyAction, getPublicState } = require('./engine');

const ROOM_PREFIX = 'poker:';

const pokerTables = new Map();

async function loadTableFromDb(tableId) {
  const r = await pool.query(
    `SELECT p.user_id AS "userId", p.seat_index AS "seatIndex", p.chips_in_hand AS "chipsInHand", u.name
     FROM poker_table_players p
     JOIN users u ON u.id = p.user_id
     WHERE p.table_id = $1 AND p.left_at IS NULL
     ORDER BY p.seat_index`,
    [tableId]
  );
  const tableRow = await pool.query('SELECT small_blind, big_blind FROM poker_tables WHERE id = $1', [tableId]);
  const sb = tableRow.rows[0]?.small_blind ?? 1;
  const bb = tableRow.rows[0]?.big_blind ?? 2;
  return { players: r.rows, smallBlind: sb, bigBlind: bb };
}

function registerPoker(io) {
  io.on('connection', (socket) => {
    socket.on('poker:join_room', async (data) => {
      const tableId = data?.tableId;
      if (!tableId) {
        socket.emit('poker:error', { message: 'Manglende tableId' });
        return;
      }
      const userId = socket.userId;
      try {
        let table = pokerTables.get(tableId);
        if (!table) {
          const { players, smallBlind, bigBlind } = await loadTableFromDb(tableId);
          const inTable = players.some((p) => p.userId === userId);
          if (!inTable) {
            socket.emit('poker:error', { message: 'Du er ikke på dette bord' });
            return;
          }
          const state = createTableState(players, smallBlind, bigBlind);
          table = { state, playerSockets: new Map() };
          pokerTables.set(tableId, table);
        } else {
          const inTable = table.state.players.some((p) => p.userId === userId);
          if (!inTable) {
            socket.emit('poker:error', { message: 'Du er ikke på dette bord' });
            return;
          }
        }
        table.playerSockets.set(userId, socket.id);
        await socket.join(ROOM_PREFIX + tableId);
        socket.pokerTableId = tableId;
        const publicState = getPublicState(table.state, userId);
        socket.emit('poker:state', publicState);
        io.to(ROOM_PREFIX + tableId).emit('poker:player_joined', { userId });
      } catch (e) {
        console.error('poker:join_room', e);
        socket.emit('poker:error', { message: 'Kunne ikke joine bord' });
      }
    });

    socket.on('poker:start_hand', async () => {
      const tableId = socket.pokerTableId;
      if (!tableId) {
        socket.emit('poker:error', { message: 'Du er ikke på et bord' });
        return;
      }
      const table = pokerTables.get(tableId);
      if (!table) {
        socket.emit('poker:error', { message: 'Bord ikke fundet' });
        return;
      }
      if (table.state.phase !== 'waiting' && table.state.phase !== 'showdown') {
        socket.emit('poker:error', { message: 'Spillet er allerede i gang' });
        return;
      }
      const n = table.state.players.filter((p) => p.chipsInHand > 0).length;
      if (n < 2) {
        socket.emit('poker:error', { message: 'Mindst 2 spillere med chips' });
        return;
      }
      const result = startHand(table.state);
      if (!result.ok) {
        socket.emit('poker:error', { message: result.error || 'Kunne ikke starte' });
        return;
      }
      const room = ROOM_PREFIX + tableId;
      table.state.players.forEach((p) => {
        const sid = table.playerSockets.get(p.userId);
        if (sid) {
          io.to(sid).emit('poker:state', getPublicState(table.state, p.userId));
        }
      });
    });

    socket.on('poker:action', (data) => {
      const tableId = socket.pokerTableId;
      if (!tableId) {
        socket.emit('poker:error', { message: 'Du er ikke på et bord' });
        return;
      }
      const table = pokerTables.get(tableId);
      if (!table) {
        socket.emit('poker:error', { message: 'Bord ikke fundet' });
        return;
      }
      const playerIndex = table.state.players.findIndex((p) => p.userId === socket.userId);
      if (playerIndex < 0) {
        socket.emit('poker:error', { message: 'Du er ikke i spillet' });
        return;
      }
      const action = data?.action;
      const amount = typeof data?.amount === 'number' ? data.amount : 0;
      const result = applyAction(table.state, playerIndex, action, amount);
      if (!result.ok) {
        socket.emit('poker:error', { message: result.error || 'Ugyldig handling' });
        return;
      }
      const room = ROOM_PREFIX + tableId;
      table.state.players.forEach((p) => {
        const sid = table.playerSockets.get(p.userId);
        if (sid) {
          io.to(sid).emit('poker:state', getPublicState(table.state, p.userId));
        }
      });
    });

    socket.on('disconnect', () => {
      const tableId = socket.pokerTableId;
      if (tableId) {
        const table = pokerTables.get(tableId);
        if (table) {
          table.playerSockets.delete(socket.userId);
          if (table.playerSockets.size === 0) {
            pokerTables.delete(tableId);
          }
        }
      }
    });
  });
}

module.exports = { registerPoker, pokerTables };
