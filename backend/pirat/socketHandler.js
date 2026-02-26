const { pool } = require('../db');
const {
  getCardsPerRound,
  createGameState,
  startRound,
  trickWinner,
  legalPlays,
  cardEq,
  getPublicState,
} = require('./engine');

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;

const ROOM_PREFIX = 'pirat:';
const games = new Map();

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function getUserName(userId) {
  const r = await pool.query('SELECT name FROM users WHERE id = $1', [userId]);
  return r.rows[0]?.name || 'Spiller';
}

function broadcastState(io, game) {
  game.state.playerIds.forEach((uid) => {
    const sid = game.playerSockets.get(uid);
    if (sid) {
      const pub = getPublicState(game.state, uid);
      if (pub) io.to(sid).emit('pirat:state', pub);
    }
  });
}

function registerPirat(io) {
  io.on('connection', (socket) => {
    socket.on('pirat:create', async () => {
      const userId = socket.userId;
      const name = await getUserName(userId);
      const code = randomCode();
      while (games.has(code)) code = randomCode();
      const state = createGameState([userId], [name]);
      state.gameCode = code;
      state.phase = 'lobby';
      const game = { state, playerSockets: new Map() };
      game.playerSockets.set(userId, socket.id);
      games.set(code, game);
      await socket.join(ROOM_PREFIX + code);
      socket.piratGameCode = code;
      const pub = getPublicState(state, userId);
      if (pub) socket.emit('pirat:state', pub);
    });

    socket.on('pirat:join', async (data) => {
      const code = String(data?.code || '').trim().toUpperCase();
      if (!code || code.length !== 6) {
        socket.emit('pirat:error', { message: 'Ugyldig spilkode (6 tegn)' });
        return;
      }
      const game = games.get(code);
      if (!game) {
        socket.emit('pirat:error', { message: 'Spil ikke fundet' });
        return;
      }
      const userId = socket.userId;
      if (game.state.playerIds.includes(userId)) {
        await socket.join(ROOM_PREFIX + code);
        socket.piratGameCode = code;
        broadcastState(io, game);
        return;
      }
      if (game.state.playerIds.length >= MAX_PLAYERS) {
        socket.emit('pirat:error', { message: 'Spillet er fuldt (max 4 spillere)' });
        return;
      }
      const name = await getUserName(userId);
      game.state.playerIds.push(userId);
      game.state.playerNames.push(name);
      game.playerSockets.set(userId, socket.id);
      await socket.join(ROOM_PREFIX + code);
      socket.piratGameCode = code;
      broadcastState(io, game);
    });

    socket.on('pirat:start', () => {
      const code = socket.piratGameCode;
      if (!code) return;
      const game = games.get(code);
      if (!game || game.state.phase !== 'lobby') {
        socket.emit('pirat:error', { message: 'Spillet er allerede startet' });
        return;
      }
      const count = game.state.playerIds.length;
      if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
        socket.emit('pirat:error', { message: 'Der skal være 2–4 spillere for at starte' });
        return;
      }
      game.state.numPlayers = count;
      game.state.phase = 'playing';
      startRound(game.state);
      broadcastState(io, game);
    });

    socket.on('pirat:bid', (data) => {
      const code = socket.piratGameCode;
      if (!code) return;
      const game = games.get(code);
      if (!game || game.state.phase !== 'bid') {
        socket.emit('pirat:error', { message: 'Budfasen er ikke aktiv' });
        return;
      }
      const playerIndex = game.state.playerIds.indexOf(socket.userId);
      if (playerIndex < 0) return;
      if (game.state.bids[playerIndex] !== null) {
        socket.emit('pirat:error', { message: 'Du har allerede budt' });
        return;
      }
      const schedule = getCardsPerRound(game.state.numPlayers || game.state.playerIds.length);
      const n = schedule[game.state.roundIndex] ?? 1;
      const bid = parseInt(data?.bid, 10);
      if (isNaN(bid) || bid < 0 || bid > n) {
        socket.emit('pirat:error', { message: 'Ugyldigt bud (0–' + n + ')' });
        return;
      }
      game.state.bids[playerIndex] = bid;
      if (game.state.bids.every((b) => b !== null)) {
        game.state.phase = 'bid_reveal';
      }
      broadcastState(io, game);
    });

    socket.on('pirat:reveal_ok', () => {
      const code = socket.piratGameCode;
      if (!code) return;
      const game = games.get(code);
      if (!game || game.state.phase !== 'bid_reveal') return;
      game.state.phase = 'play';
      game.state.currentPlayer = game.state.leader;
      game.state.trick = [];
      game.state.trickLeader = game.state.leader;
      broadcastState(io, game);
    });

    socket.on('pirat:play_card', (data) => {
      const code = socket.piratGameCode;
      if (!code) return;
      const game = games.get(code);
      if (!game || game.state.phase !== 'play') {
        socket.emit('pirat:error', { message: 'Spil ikke i spilfase' });
        return;
      }
      const playerIndex = game.state.playerIds.indexOf(socket.userId);
      if (playerIndex !== game.state.currentPlayer) {
        socket.emit('pirat:error', { message: 'Ikke din tur' });
        return;
      }
      const card = data?.card;
      if (!card || typeof card.s !== 'string' || typeof card.r !== 'number') {
        socket.emit('pirat:error', { message: 'Ugyldigt kort' });
        return;
      }
      const hand = game.state.hands[playerIndex];
      const leadSuit = game.state.trick.length > 0 ? game.state.trick[0].s : null;
      const legal = legalPlays(hand, leadSuit);
      const idx = hand.findIndex((c) => cardEq(c, card));
      if (idx < 0 || !legal.some((c) => cardEq(c, card))) {
        socket.emit('pirat:error', { message: 'Du kan ikke spille det kort' });
        return;
      }
      hand.splice(idx, 1);
      game.state.trick.push(card);
      const numPlayers = game.state.numPlayers || game.state.playerIds.length;
      if (game.state.trick.length === numPlayers) {
        const winner = trickWinner(game.state.trick, game.state.trickLeader, numPlayers);
        game.state.tricksWon[winner]++;
        game.state.leader = winner;
        game.state.currentPlayer = winner;
        game.state.trick = [];
        game.state.trickLeader = winner;
      } else {
        game.state.currentPlayer = (game.state.currentPlayer + 1) % numPlayers;
      }

      const schedulePlay = getCardsPerRound(game.state.numPlayers || game.state.playerIds.length);
      const n = schedulePlay[game.state.roundIndex] ?? 1;
      const tricksSoFar = game.state.tricksWon.reduce((a, b) => a + b, 0);
      if (tricksSoFar === n) {
        game.state.phase = 'round_done';
        game.state.playerIds.forEach((_, i) => {
          const bid = game.state.bids[i];
          const took = game.state.tricksWon[i];
          if (bid === took) game.state.scores[i] += 10 + took;
          else game.state.scores[i] -= Math.abs(bid - took);
        });
      }
      broadcastState(io, game);
    });

    socket.on('pirat:next_round', () => {
      const code = socket.piratGameCode;
      if (!code) return;
      const game = games.get(code);
      if (!game || game.state.phase !== 'round_done') return;
      game.state.roundIndex++;
      const roundSchedule = getCardsPerRound(game.state.numPlayers || game.state.playerIds.length);
      if (game.state.roundIndex >= roundSchedule.length) {
        game.state.phase = 'game_over';
      } else {
        startRound(game.state);
      }
      broadcastState(io, game);
    });

    socket.on('disconnect', () => {
      const code = socket.piratGameCode;
      if (!code) return;
      const game = games.get(code);
      if (!game) return;
      const userId = socket.userId;
      game.playerSockets.delete(userId);
      const idx = game.state.playerIds.indexOf(userId);
      if (idx >= 0 && game.state.phase === 'lobby') {
        game.state.playerIds.splice(idx, 1);
        game.state.playerNames.splice(idx, 1);
        if (game.state.playerIds.length === 0) {
          games.delete(code);
        } else {
          game.state.playerIds.forEach((uid) => {
            const sid = game.playerSockets.get(uid);
            if (sid) {
              const pub = getPublicState(game.state, uid);
              if (pub) io.to(sid).emit('pirat:state', pub);
            }
          });
        }
      }
    });
  });
}

module.exports = { registerPirat, games };
