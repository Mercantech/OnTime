/** Meyer (liar's dice) engine. Two dice 1–6; roll = [high, low]. */

const START_LIVES = 6;
const REROLL_LIVES_AT = 3;

/** All rolls from best to worst: Roll of Cheers, Meyer, Little Meyer, pairs, then 65…41 */
const ROLL_ORDER = [
  [3, 2],   // Roll of Cheers (ends round)
  [2, 1],   // Meyer
  [3, 1],   // Little Meyer
  [6, 6], [5, 5], [4, 4], [3, 3], [2, 2], [1, 1],
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1],
  [5, 4], [5, 3], [5, 2], [5, 1],
  [4, 3], [4, 2], [4, 1],
];

function normalizeRoll(dice) {
  const [a, b] = Array.isArray(dice) && dice.length >= 2 ? [dice[0], dice[1]] : [1, 1];
  return [Math.max(a, b), Math.min(a, b)];
}

function rollToLabel(dice) {
  const [h, l] = normalizeRoll(dice);
  if (h === 3 && l === 2) return 'roll_of_cheers';
  if (h === 2 && l === 1) return 'meyer';
  if (h === 3 && l === 1) return 'little_meyer';
  if (h === l) return `pair_${h}${l}`;
  return `${h}${l}`;
}

function rollToRank(dice) {
  const r = normalizeRoll(dice);
  const i = ROLL_ORDER.findIndex(([a, b]) => a === r[0] && b === r[1]);
  return i >= 0 ? ROLL_ORDER.length - i : 0;
}

function compareRolls(a, b) {
  return rollToRank(a) - rollToRank(b);
}

function isRollOfCheers(dice) {
  const [h, l] = normalizeRoll(dice);
  return h === 3 && l === 2;
}

function isMeyer(dice) {
  const [h, l] = normalizeRoll(dice);
  return h === 2 && l === 1;
}

/** All possible declarations (rolls) that are >= previousDeclared. previousDeclared null = turn 1. */
function getPossibleDeclarations(actualRoll, previousDeclared, isTurn1) {
  const actualNorm = normalizeRoll(actualRoll);
  const list = ROLL_ORDER.map((r) => ({ high: r[0], low: r[1] }));
  if (isTurn1) {
    return list.filter((r) => r.high !== actualNorm[0] || r.low !== actualNorm[1]);
  }
  if (!previousDeclared) return list;
  const prev = [previousDeclared.high, previousDeclared.low];
  return list.filter((r) => compareRolls([r.high, r.low], prev) >= 0);
}

function canTruth(actualRoll, previousDeclared, isTurn1) {
  if (isTurn1) return true;
  if (!previousDeclared) return true;
  return compareRolls(normalizeRoll(actualRoll), [previousDeclared.high, previousDeclared.low]) >= 0;
}

function rollDice() {
  return [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
}

function createGameState(playerIds, playerNames) {
  const n = playerIds.length;
  return {
    playerIds: [...playerIds],
    playerNames: [...playerNames],
    numPlayers: n,
    phase: 'lobby',
    lives: Array(n).fill(START_LIVES),
    hasRerolledAtThree: Array(n).fill(false),
    roundStarterIndex: 0,
    turnIndex: 0,
    turnNumber: 1,
    declaredRoll: null,
    lastDeclaredBy: null,
    currentRoll: null,
    currentRollHidden: null,
    gameCode: null,
  };
}

function startRound(state) {
  const n = state.numPlayers || state.playerIds.length;
  state.turnIndex = state.roundStarterIndex;
  state.turnNumber = 1;
  state.declaredRoll = null;
  state.lastDeclaredBy = null;
  state.currentRoll = null;
  state.currentRollHidden = null;
  state.lastActualRoll = null;
  state.lastActualRollBy = null;
  state.phase = 'playing';
  state.checkReveal = null;
  const playerIndex = state.roundStarterIndex % n;
  const dice = rollDice();
  state.currentRoll = normalizeRoll(dice);
  state.currentRollVisibleTo = playerIndex;
}

function getPublicState(state, userId) {
  const myIndex = state.playerIds.indexOf(userId);
  if (myIndex < 0) return null;
  const n = state.numPlayers || state.playerIds.length;
  const isMyTurn = state.turnIndex === myIndex;
  const currentRoll = isMyTurn && state.currentRoll ? state.currentRoll : null;
  const canCheck = state.phase === 'playing' && !state.currentRollHidden && state.turnNumber > 1;
  const canSameOrHigher = state.phase === 'playing' && state.turnNumber > 1 && state.currentRoll && !state.currentRollHidden;
  const bluffOptions = state.phase === 'playing' && state.currentRoll
    ? getPossibleDeclarations(state.currentRoll, state.declaredRoll, state.turnNumber === 1)
    : [];
  return {
    gameCode: state.gameCode,
    myIndex,
    numPlayers: n,
    playerCount: state.playerIds.length,
    playerNames: state.playerNames,
    phase: state.phase,
    lives: state.lives,
    roundStarterIndex: state.roundStarterIndex,
    turnIndex: state.turnIndex,
    turnNumber: state.turnNumber,
    declaredRoll: state.declaredRoll,
    lastDeclaredBy: state.lastDeclaredBy,
    currentRoll,
    currentRollHidden: isMyTurn ? state.currentRollHidden : null,
    canCheck,
    canTruth: state.currentRoll && canTruth(state.currentRoll, state.declaredRoll, state.turnNumber === 1),
    canSameOrHigher,
    bluffOptions,
    checkReveal: state.checkReveal,
    lastActualRoll: state.lastActualRoll,
    lastActualRollBy: state.lastActualRollBy,
    winnerIndex: state.winnerIndex,
  };
}

module.exports = {
  START_LIVES,
  REROLL_LIVES_AT,
  ROLL_ORDER,
  normalizeRoll,
  rollToLabel,
  rollToRank,
  compareRolls,
  isRollOfCheers,
  isMeyer,
  getPossibleDeclarations,
  canTruth,
  rollDice,
  createGameState,
  startRound,
  getPublicState,
};
