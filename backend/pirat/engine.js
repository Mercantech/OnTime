const SUITS = ['C', 'D', 'H', 'S'];
const TRUMP = 'S';

/** Rundeplan per antal spillere: antal kort per spiller per runde. */
function getCardsPerRound(numPlayers) {
  if (numPlayers === 4) return [1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1];
  if (numPlayers === 3) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  if (numPlayers === 2) return Array(26).fill(1);
  return [1];
}

function makeDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (let r = 2; r <= 14; r++) deck.push({ s, r });
  }
  return deck;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardOrder(c) {
  return (SUITS.indexOf(c.s) * 20) + c.r;
}

function legalPlays(hand, leadSuit) {
  if (!leadSuit) return hand.slice();
  const ofSuit = hand.filter((c) => c.s === leadSuit);
  if (ofSuit.length) return ofSuit;
  return hand.slice();
}

function trickWinner(cards, leaderIndex, numPlayers) {
  const leadSuit = cards[0].s;
  let best = 0;
  for (let i = 1; i < cards.length; i++) {
    const c = cards[i];
    const b = cards[best];
    if (c.s === TRUMP && b.s !== TRUMP) best = i;
    else if (c.s !== TRUMP && b.s === TRUMP) {}
    else if (c.s === leadSuit && b.s !== leadSuit) best = i;
    else if (c.s !== leadSuit && b.s === leadSuit) {}
    else if (c.s === b.s && c.r > b.r) best = i;
  }
  return (leaderIndex + best) % numPlayers;
}

function createGameState(playerIds, playerNames) {
  const n = playerIds.length;
  return {
    playerIds: [...playerIds],
    playerNames: [...playerNames],
    numPlayers: n,
    roundIndex: 0,
    dealer: 0,
    hands: Array.from({ length: n }, () => []),
    bids: Array(n).fill(null),
    phase: 'lobby',
    currentPlayer: 0,
    leader: 0,
    trick: [],
    trickLeader: 0,
    tricksWon: Array(n).fill(0),
    scores: Array(n).fill(0),
  };
}

function startRound(state) {
  const numPlayers = state.numPlayers || state.playerIds.length;
  const schedule = getCardsPerRound(numPlayers);
  const n = schedule[state.roundIndex] ?? 1;
  const deck = shuffle(makeDeck());
  const cardsToDeal = n * numPlayers;
  state.hands = Array.from({ length: numPlayers }, () => []);
  state.dealer = state.roundIndex % numPlayers;
  state.leader = (state.dealer + 1) % numPlayers;
  for (let i = 0; i < cardsToDeal && i < deck.length; i++) {
    state.hands[i % numPlayers].push(deck[i]);
  }
  state.hands.forEach((h) => h.sort((a, b) => cardOrder(a) - cardOrder(b)));
  state.bids = Array(numPlayers).fill(null);
  state.tricksWon = Array(numPlayers).fill(0);
  state.phase = 'bid';
  state.currentPlayer = state.leader;
  state.trick = [];
  state.trickLeader = state.leader;
}

function cardEq(a, b) {
  return a && b && a.s === b.s && a.r === b.r;
}

function getPublicState(state, userId) {
  const myIndex = state.playerIds.indexOf(userId);
  if (myIndex < 0) return null;
  const numPlayers = state.numPlayers || state.playerIds.length;
  const schedule = getCardsPerRound(numPlayers);
  const n = schedule[state.roundIndex] ?? 1;
  const leadSuit = state.trick.length > 0 ? state.trick[0].s : null;
  const myHand = state.hands[myIndex] || [];
  const legalCards = legalPlays(myHand, leadSuit);
  const trickWithPlayer = (state.trick || []).map((c, i) => ({
    card: c,
    playedBy: (state.trickLeader + i) % numPlayers,
  }));
  return {
    gameCode: state.gameCode,
    myIndex,
    numPlayers,
    playerCount: state.playerIds.length,
    numRounds: schedule.length,
    playerNames: state.playerNames,
    roundIndex: state.roundIndex,
    n,
    dealer: state.dealer,
    myHand,
    legalCards,
    bids: state.bids,
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    leader: state.leader,
    trickWithPlayer,
    tricksWon: state.tricksWon,
    scores: state.scores,
  };
}

module.exports = {
  SUITS,
  TRUMP,
  getCardsPerRound,
  makeDeck,
  shuffle,
  cardOrder,
  legalPlays,
  trickWinner,
  createGameState,
  startRound,
  cardEq,
  getPublicState,
};
