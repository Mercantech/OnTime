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
        const { players: dbPlayers, smallBlind, bigBlind } = await loadTableFromDb(tableId);
        const userInDb = dbPlayers.find((p) => p.userId === userId);
        if (!userInDb) {
          socket.emit('poker:error', { message: 'Du er ikke på dette bord' });
          return;
        }
        let table = pokerTables.get(tableId);
        if (!table) {
          const state = createTableState(dbPlayers, smallBlind, bigBlind);
          table = { state, playerSockets: new Map(), endGameVotes: new Set() };
          pokerTables.set(tableId, table);
        } else {
          if (!table.endGameVotes) table.endGameVotes = new Set();
          for (const dbP of dbPlayers) {
            const inState = table.state.players.some((p) => p.userId === dbP.userId);
            if (!inState) {
              table.state.players.push({
                userId: dbP.userId,
                name: dbP.name,
                seatIndex: dbP.seatIndex,
                chipsInHand: dbP.chipsInHand,
                holeCards: [],
                folded: false,
                currentBet: 0,
                totalBetThisRound: 0,
                isAllIn: false,
              });
            }
          }
          table.state.players.sort((a, b) => a.seatIndex - b.seatIndex);
        }
        table.playerSockets.set(userId, socket.id);
        await socket.join(ROOM_PREFIX + tableId);
        socket.pokerTableId = tableId;
        // Send opdateret state til alle i rummet (så opretteren også ser den nye spiller og kan starte)
        table.state.players.forEach((p) => {
          const sid = table.playerSockets.get(p.userId);
          if (sid) {
            io.to(sid).emit('poker:state', getPublicState(table.state, p.userId));
          }
        });
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

    socket.on('poker:vote_end_game', async () => {
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
      const userId = socket.userId;
      const player = table.state.players.find((p) => p.userId === userId);
      if (!player) {
        socket.emit('poker:error', { message: 'Du er ikke i spillet' });
        return;
      }
      table.endGameVotes.add(userId);
      const totalPlayers = table.state.players.length;
      const voted = table.endGameVotes.size;
      if (voted < totalPlayers) {
        table.state.players.forEach((p) => {
          const sid = table.playerSockets.get(p.userId);
          if (sid) {
            io.to(sid).emit('poker:state', { ...getPublicState(table.state, p.userId), endGameVotes: voted, endGameVotesNeeded: totalPlayers });
          }
        });
        return;
      }
      try {
        for (const p of table.state.players) {
          if (p.chipsInHand > 0) {
            await pool.query(
              'INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, $3)',
              [p.userId, p.chipsInHand, 'Poker afsluttet']
            );
            await pool.query(
              'UPDATE poker_table_players SET left_at = NOW(), chips_in_hand = 0 WHERE table_id = $1 AND user_id = $2',
              [tableId, p.userId]
            );
          }
        }
        const room = ROOM_PREFIX + tableId;
        const chipsByUser = Object.fromEntries(table.state.players.map((p) => [p.userId, p.chipsInHand]));
        io.to(room).emit('poker:game_ended', { message: 'Spillet er afsluttet. I beholder jeres point.', chipsReceived: chipsByUser });
      } catch (e) {
        console.error('poker:vote_end_game', e);
        socket.emit('poker:error', { message: 'Kunne ikke afslutte spil' });
        return;
      }
      pokerTables.delete(tableId);
    });

    socket.on('disconnect', async () => {
      const tableId = socket.pokerTableId;
      const userId = socket.userId;
      if (!tableId) return;
      const table = pokerTables.get(tableId);
      if (!table) return;
      const player = table.state.players.find((p) => p.userId === userId);
      const wasWaiting = table.state.phase === 'waiting';
      if (wasWaiting && player && player.chipsInHand > 0) {
        try {
          await pool.query(
            `INSERT INTO point_transactions (user_id, delta, reason) VALUES ($1, $2, $3)`,
            [userId, player.chipsInHand, 'Poker refund']
          );
          await pool.query(
            `UPDATE poker_table_players SET left_at = NOW(), chips_in_hand = 0 WHERE table_id = $1 AND user_id = $2`,
            [tableId, userId]
          );
        } catch (e) {
          console.error('Poker refund ved disconnect:', e);
        }
        const idx = table.state.players.findIndex((p) => p.userId === userId);
        if (idx >= 0) table.state.players.splice(idx, 1);
      }
      table.playerSockets.delete(userId);
      if (table.playerSockets.size === 0) {
        pokerTables.delete(tableId);
      } else {
        table.state.players.forEach((p) => {
          const sid = table.playerSockets.get(p.userId);
          if (sid) {
            io.to(sid).emit('poker:state', getPublicState(table.state, p.userId));
          }
        });
      }
    });
  });
}

module.exports = { registerPoker, pokerTables };
