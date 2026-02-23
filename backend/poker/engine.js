const { createDeck, shuffle } = require('./cards');
const { bestFiveFromSeven, findWinners } = require('./handRank');

const PHASES = ['waiting', 'preflop', 'flop', 'turn', 'river', 'showdown'];

function createTableState(players, smallBlind = 1, bigBlind = 2) {
  return {
    phase: 'waiting',
    players: players.map((p) => ({
      userId: p.userId,
      name: p.name,
      seatIndex: p.seatIndex,
      chipsInHand: p.chipsInHand,
      holeCards: [],
      folded: false,
      currentBet: 0,
      totalBetThisRound: 0,
      isAllIn: false,
    })),
    deck: [],
    communityCards: [],
    pot: 0,
    currentBetToCall: 0,
    dealerIndex: 0,
    currentTurnIndex: 0,
    smallBlind,
    bigBlind,
    winners: null,
  };
}

function startHand(state) {
  const canStart = state.phase === 'waiting' || state.phase === 'showdown';
  if (!canStart || state.players.filter((p) => p.chipsInHand > 0).length < 2) {
    return { ok: false, error: 'Kan ikke starte hånd' };
  }
  if (state.phase === 'showdown') {
    state.phase = 'waiting';
    state.communityCards = [];
    state.winners = null;
    state.players.forEach((p) => {
      p.holeCards = [];
      p.folded = false;
      p.currentBet = 0;
      p.totalBetThisRound = 0;
      p.isAllIn = false;
    });
  }
  const active = state.players.filter((p) => p.chipsInHand > 0);
  if (active.length < 2) return { ok: false, error: 'Mindst 2 spillere med chips' };

  const deck = shuffle(createDeck());
  state.deck = deck;
  state.communityCards = [];
  state.pot = 0;
  state.phase = 'preflop';

  const n = active.length;
  active.forEach((p) => {
    p.holeCards = [deck.pop(), deck.pop()];
    p.folded = false;
    p.currentBet = 0;
    p.totalBetThisRound = 0;
    p.isAllIn = false;
  });

  state.dealerIndex = 0;
  const sbIndex = 1 % n;
  const bbIndex = 2 % n;
  const sbPlayer = state.players[sbIndex];
  const bbPlayer = state.players[bbIndex];
  const sb = Math.min(state.smallBlind, sbPlayer.chipsInHand);
  const bb = Math.min(state.bigBlind, bbPlayer.chipsInHand);
  sbPlayer.chipsInHand -= sb;
  sbPlayer.currentBet = sb;
  sbPlayer.totalBetThisRound = sb;
  bbPlayer.chipsInHand -= bb;
  bbPlayer.currentBet = bb;
  bbPlayer.totalBetThisRound = bb;
  state.pot = sb + bb;
  state.currentBetToCall = bb;
  state.currentTurnIndex = (bbIndex + 1) % n;
  return { ok: true };
}

function advanceToNextPhase(state) {
  const active = state.players.filter((p) => !p.folded && p.chipsInHand > 0);
  const inHand = state.players.filter((p) => !p.folded);
  if (inHand.length === 1) {
    state.phase = 'showdown';
    state.winners = [state.players.indexOf(inHand[0])];
    return;
  }
  if (active.length < 2) {
    state.phase = 'showdown';
    state.winners = state.players.map((p, i) => (p.folded ? null : i)).filter((x) => x !== null);
    return;
  }

  state.players.forEach((p) => {
    state.pot += p.totalBetThisRound;
    p.currentBet = 0;
    p.totalBetThisRound = 0;
  });
  state.currentBetToCall = 0;

  if (state.phase === 'preflop') {
    state.phase = 'flop';
    state.communityCards = [state.deck.pop(), state.deck.pop(), state.deck.pop()];
    state.currentTurnIndex = (state.dealerIndex + 1) % state.players.length;
    return;
  }
  if (state.phase === 'flop') {
    state.phase = 'turn';
    state.communityCards.push(state.deck.pop());
    state.currentTurnIndex = (state.dealerIndex + 1) % state.players.length;
    return;
  }
  if (state.phase === 'turn') {
    state.phase = 'river';
    state.communityCards.push(state.deck.pop());
    state.currentTurnIndex = (state.dealerIndex + 1) % state.players.length;
    return;
  }
  if (state.phase === 'river') {
    state.phase = 'showdown';
    const stillIn = state.players.map((p, i) => (p.folded ? null : { i, cards: [...p.holeCards, ...state.communityCards] })).filter((x) => x !== null);
    const cardsPerPlayer = stillIn.map((x) => x.cards);
    const winnerIndices = findWinners(cardsPerPlayer);
    state.winners = winnerIndices.map((wi) => stillIn[wi].i);
    const share = Math.floor(state.pot / state.winners.length);
    const remainder = state.pot - share * state.winners.length;
    state.winners.forEach((idx, i) => {
      state.players[idx].chipsInHand += share + (i < remainder ? 1 : 0);
    });
    state.pot = 0;
    return;
  }
}

function nextPlayer(state) {
  const active = state.players.filter((p) => !p.folded && !p.isAllIn);
  let idx = state.currentTurnIndex;
  for (let i = 0; i < state.players.length; i++) {
    idx = (state.currentTurnIndex + 1 + i) % state.players.length;
    const p = state.players[idx];
    if (!p.folded && !p.isAllIn) {
      state.currentTurnIndex = idx;
      return idx;
    }
  }
  return -1;
}

function allBetsMatched(state) {
  const active = state.players.filter((p) => !p.folded && !p.isAllIn);
  return active.every((p) => p.totalBetThisRound >= state.currentBetToCall);
}

function applyAction(state, playerIndex, action, amount = 0) {
  const p = state.players[playerIndex];
  if (!p || p.folded || p.isAllIn) return { ok: false, error: 'Ugyldig handling' };
  if (state.currentTurnIndex !== playerIndex) return { ok: false, error: 'Ikke din tur' };

  if (action === 'fold') {
    p.folded = true;
    const stillIn = state.players.filter((x) => !x.folded);
    if (stillIn.length === 1) {
      state.phase = 'showdown';
      const winnerIdx = state.players.indexOf(stillIn[0]);
      state.winners = [winnerIdx];
      state.players[winnerIdx].chipsInHand += state.pot;
      state.pot = 0;
      return { ok: true, phase: 'showdown' };
    }
    const next = nextPlayer(state);
    if (next < 0) {
      advanceToNextPhase(state);
      return { ok: true, phase: state.phase };
    }
    return { ok: true, nextTurn: next };
  }

  if (action === 'check') {
    if (p.totalBetThisRound < state.currentBetToCall) return { ok: false, error: 'Du skal call eller raise' };
    const next = nextPlayer(state);
    if (next < 0) {
      advanceToNextPhase(state);
      return { ok: true, phase: state.phase };
    }
    if (next === state.dealerIndex || allBetsMatched(state)) {
      advanceToNextPhase(state);
      return { ok: true, phase: state.phase };
    }
    return { ok: true, nextTurn: next };
  }

  if (action === 'call') {
    const toCall = state.currentBetToCall - p.totalBetThisRound;
    const pay = Math.min(toCall, p.chipsInHand);
    p.chipsInHand -= pay;
    p.currentBet += pay;
    p.totalBetThisRound += pay;
    if (p.chipsInHand === 0) p.isAllIn = true;
    const next = nextPlayer(state);
    if (next < 0) {
      advanceToNextPhase(state);
      return { ok: true, phase: state.phase };
    }
    if (allBetsMatched(state)) {
      advanceToNextPhase(state);
      return { ok: true, phase: state.phase };
    }
    return { ok: true, nextTurn: next };
  }

  if (action === 'raise') {
    const minRaise = state.currentBetToCall + state.bigBlind;
    const raiseTo = Math.max(minRaise, amount);
    const toPay = raiseTo - p.totalBetThisRound;
    if (toPay <= 0) return { ok: false, error: 'Raise skal være højere end current bet' };
    const pay = Math.min(toPay, p.chipsInHand);
    p.chipsInHand -= pay;
    p.currentBet += pay;
    p.totalBetThisRound += pay;
    if (p.chipsInHand === 0) p.isAllIn = true;
    state.currentBetToCall = p.totalBetThisRound;
    const next = nextPlayer(state);
    if (next < 0) {
      advanceToNextPhase(state);
      return { ok: true, phase: state.phase };
    }
    return { ok: true, nextTurn: next };
  }

  return { ok: false, error: 'Ukendt handling' };
}

function getPublicState(state, forUserId) {
  const players = state.players.map((p) => ({
    userId: p.userId,
    name: p.name,
    seatIndex: p.seatIndex,
    chipsInHand: p.chipsInHand,
    holeCards: forUserId === p.userId ? p.holeCards : (p.holeCards.length ? ['??', '??'] : []),
    folded: p.folded,
    currentBet: p.currentBet,
    totalBetThisRound: p.totalBetThisRound,
    isAllIn: p.isAllIn,
  }));
  return {
    phase: state.phase,
    players,
    communityCards: state.communityCards,
    pot: state.pot,
    currentBetToCall: state.currentBetToCall,
    dealerIndex: state.dealerIndex,
    currentTurnIndex: state.currentTurnIndex,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    winners: state.winners,
  };
}

module.exports = {
  PHASES,
  createTableState,
  startHand,
  advanceToNextPhase,
  applyAction,
  getPublicState,
};
