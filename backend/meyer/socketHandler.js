const { pool } = require('../db');
const {
  createGameState,
  startRound,
  getPublicState,
  rollDice,
  normalizeRoll,
  rollToLabel,
  compareRolls,
  isRollOfCheers,
  isMeyer,
  getPossibleDeclarations,
  canTruth,
  START_LIVES,
  REROLL_LIVES_AT,
} = require('./engine');

const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;
const ROOM_PREFIX = 'meyer:';
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
      if (pub) io.to(sid).emit('meyer:state', pub);
    }
  });
}

function applyLifeLoss(state, playerIndex, amount) {
  state.lives[playerIndex] = Math.max(0, (state.lives[playerIndex] || 0) - amount);
  const n = state.numPlayers || state.playerIds.length;
  if (state.lives[playerIndex] === REROLL_LIVES_AT && !state.hasRerolledAtThree[playerIndex]) {
    state.hasRerolledAtThree[playerIndex] = true;
    state.lives[playerIndex] = 1 + Math.floor(Math.random() * 6);
  }
  const alive = state.lives.map((l, i) => (l > 0 ? i : -1)).filter((i) => i >= 0);
  if (alive.length <= 1) {
    state.phase = 'game_over';
    state.winnerIndex = alive[0] ?? null;
  }
}

function advanceTurn(state) {
  const n = state.numPlayers || state.playerIds.length;
  state.turnIndex = (state.turnIndex + 1) % n;
  state.turnNumber += 1;
  const nextPlayer = state.turnIndex;
  const dice = rollDice();
  state.currentRoll = normalizeRoll(dice);
  state.currentRollVisibleTo = nextPlayer;
  state.currentRollHidden = false;
}

function registerMeyer(io) {
  io.on('connection', (socket) => {
    socket.on('meyer:create', async () => {
      const userId = socket.userId;
      const name = await getUserName(userId);
      const code = randomCode();
      while (games.has(code)) code = randomCode();
      const state = createGameState([userId], [name]);
      state.gameCode = code;
      const game = { state, playerSockets: new Map() };
      game.playerSockets.set(userId, socket.id);
      games.set(code, game);
      await socket.join(ROOM_PREFIX + code);
      socket.meyerGameCode = code;
      const pub = getPublicState(state, userId);
      if (pub) socket.emit('meyer:state', pub);
    });

    socket.on('meyer:join', async (data) => {
      const code = String(data?.code || '').trim().toUpperCase();
      if (!code || code.length !== 6) {
        socket.emit('meyer:error', { message: 'Ugyldig spilkode (6 tegn)' });
        return;
      }
      const game = games.get(code);
      if (!game) {
        socket.emit('meyer:error', { message: 'Spil ikke fundet' });
        return;
      }
      const userId = socket.userId;
      if (game.state.playerIds.includes(userId)) {
        await socket.join(ROOM_PREFIX + code);
        socket.meyerGameCode = code;
        broadcastState(io, game);
        return;
      }
      if (game.state.playerIds.length >= MAX_PLAYERS) {
        socket.emit('meyer:error', { message: 'Spillet er fuldt (max 6 spillere)' });
        return;
      }
      const name = await getUserName(userId);
      game.state.playerIds.push(userId);
      game.state.playerNames.push(name);
      game.state.numPlayers = game.state.playerIds.length;
      if (!Array.isArray(game.state.lives)) game.state.lives = [];
      while (game.state.lives.length < game.state.playerIds.length) game.state.lives.push(START_LIVES);
      if (!Array.isArray(game.state.hasRerolledAtThree)) game.state.hasRerolledAtThree = [];
      while (game.state.hasRerolledAtThree.length < game.state.playerIds.length) game.state.hasRerolledAtThree.push(false);
      game.playerSockets.set(userId, socket.id);
      await socket.join(ROOM_PREFIX + code);
      socket.meyerGameCode = code;
      broadcastState(io, game);
    });

    socket.on('meyer:start', () => {
      const code = socket.meyerGameCode;
      if (!code) return;
      const game = games.get(code);
      if (!game || game.state.phase !== 'lobby') {
        socket.emit('meyer:error', { message: 'Spillet er allerede startet' });
        return;
      }
      const count = game.state.playerIds.length;
      if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
        socket.emit('meyer:error', { message: 'Der skal være 2–6 spillere for at starte' });
        return;
      }
      game.state.numPlayers = count;
      startRound(game.state);
      broadcastState(io, game);
    });

    socket.on('meyer:action', (data) => {
      const code = socket.meyerGameCode;
      if (!code) return;
      const game = games.get(code);
      if (!game || game.state.phase !== 'playing') {
        socket.emit('meyer:error', { message: 'Spillet er ikke aktivt' });
        return;
      }
      const playerIndex = game.state.playerIds.indexOf(socket.userId);
      if (playerIndex !== game.state.turnIndex) {
        socket.emit('meyer:error', { message: 'Ikke din tur' });
        return;
      }
      const type = data?.type;
      const n = game.state.numPlayers || game.state.playerIds.length;

      if (type === 'check') {
        if (game.state.turnNumber === 1) {
          socket.emit('meyer:error', { message: 'Du kan ikke checke på tur 1' });
          return;
        }
        const declared = game.state.declaredRoll;
        const actual = game.state.lastActualRoll;
        const whoDeclared = game.state.lastDeclaredBy;
        if (whoDeclared == null || !actual) {
          socket.emit('meyer:error', { message: 'Ingen at checke' });
          return;
        }
        const declaredArr = declared ? [declared.high, declared.low] : null;
        const actualBeatsDeclared = declaredArr && compareRolls(actual, declaredArr) >= 0;
        const wasMeyer = declared && isMeyer([declared.high, declared.low]);
        game.state.checkReveal = {
          whoDeclared,
          declaredRoll: declared,
          actualRoll: actual,
          actualBeatsDeclared,
          checkerIndex: playerIndex,
        };
        if (actualBeatsDeclared) {
          applyLifeLoss(game.state, playerIndex, wasMeyer ? 2 : 1);
          game.state.roundStarterIndex = playerIndex;
        } else {
          applyLifeLoss(game.state, whoDeclared, wasMeyer ? 2 : 1);
          game.state.roundStarterIndex = whoDeclared;
        }
        game.state.phase = 'check_done';
        broadcastState(io, game);
        return;
      }

      if (type === 'truth' || type === 'bluff' || type === 'same_or_higher') {
        const currentRoll = game.state.currentRoll;
        if (!currentRoll) {
          socket.emit('meyer:error', { message: 'Ingen rul at erklære' });
          return;
        }
        const isTurn1 = game.state.turnNumber === 1;
        const prevDeclared = game.state.declaredRoll;

        if (type === 'truth') {
          if (!canTruth(currentRoll, prevDeclared, isTurn1)) {
            socket.emit('meyer:error', { message: 'Du kan ikke sige sandheden med dette rul' });
            return;
          }
          if (isRollOfCheers(currentRoll)) {
            game.state.roundStarterIndex = playerIndex;
            game.state.checkReveal = { rollOfCheers: true, whoRolled: playerIndex, roll: currentRoll };
            game.state.phase = 'roll_of_cheers';
            broadcastState(io, game);
            return;
          }
          game.state.declaredRoll = { high: currentRoll[0], low: currentRoll[1] };
          game.state.lastDeclaredBy = playerIndex;
          game.state.lastActualRoll = currentRoll;
          advanceTurn(game.state);
          broadcastState(io, game);
          return;
        }

        if (type === 'bluff') {
          const high = data?.declaredRoll?.high ?? data?.declaredRoll?.[0];
          const low = data?.declaredRoll?.low ?? data?.declaredRoll?.[1];
          if (high == null || low == null) {
            socket.emit('meyer:error', { message: 'Ugyldigt bluff-rul' });
            return;
          }
          const declared = [Number(high), Number(low)].sort((a, b) => b - a);
          const allowed = getPossibleDeclarations(currentRoll, prevDeclared, isTurn1);
          const ok = allowed.some((r) => r.high === declared[0] && r.low === declared[1]);
          if (!ok) {
            socket.emit('meyer:error', { message: 'Du kan ikke erklære det rul' });
            return;
          }
          game.state.declaredRoll = { high: declared[0], low: declared[1] };
          game.state.lastDeclaredBy = playerIndex;
          game.state.lastActualRoll = currentRoll;
          advanceTurn(game.state);
          broadcastState(io, game);
          return;
        }

        if (type === 'same_or_higher') {
          if (isTurn1) {
            socket.emit('meyer:error', { message: 'Same or higher er ikke tilladt på tur 1' });
            return;
          }
          const dice = rollDice();
          const hiddenRoll = normalizeRoll(dice);
          game.state.lastActualRoll = hiddenRoll;
          game.state.lastDeclaredBy = playerIndex;
          game.state.declaredRoll = game.state.declaredRoll;
          advanceTurn(game.state);
          broadcastState(io, game);
          return;
        }
      }

      socket.emit('meyer:error', { message: 'Ugyldig handling' });
    });

    socket.on('meyer:next_round', () => {
      const code = socket.meyerGameCode;
      if (!code) return;
      const game = games.get(code);
      if (!game) return;
      const phase = game.state.phase;
      if (phase !== 'check_done' && phase !== 'roll_of_cheers') return;
      game.state.checkReveal = null;
      if (game.state.phase === 'game_over') return;
      game.state.phase = 'playing';
      startRound(game.state);
      broadcastState(io, game);
    });

    socket.on('disconnect', () => {
      const code = socket.meyerGameCode;
      if (!code) return;
      const game = games.get(code);
      if (!game) return;
      const idx = game.state.playerIds.indexOf(socket.userId);
      if (idx >= 0) game.playerSockets.delete(game.state.playerIds[idx]);
    });
  });
}

module.exports = { registerMeyer, games };
