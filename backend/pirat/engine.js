const SUITS = ['C', 'D', 'H', 'S'];
const TRUMP = 'S';
const CARDS_PER_ROUND = [1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1];
const NUM_PLAYERS = 4;

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

function trickWinner(cards, leaderIndex) {
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
  return (leaderIndex + best) % NUM_PLAYERS;
}

function createGameState(playerIds, playerNames) {
  return {
    playerIds: [...playerIds],
    playerNames: [...playerNames],
    roundIndex: 0,
    dealer: 0,
    hands: [[], [], [], []],
    bids: [null, null, null, null],
    phase: 'lobby',
    currentPlayer: 0,
    leader: 0,
    trick: [],
    trickLeader: 0,
    tricksWon: [0, 0, 0, 0],
    scores: [0, 0, 0, 0],
  };
}

function startRound(state) {
  const n = CARDS_PER_ROUND[state.roundIndex] || 1;
  const deck = shuffle(makeDeck());
  state.hands = [[], [], [], []];
  state.dealer = state.roundIndex % NUM_PLAYERS;
  state.leader = (state.dealer + 1) % NUM_PLAYERS;
  let idx = 0;
  for (let i = 0; i < n * NUM_PLAYERS; i++) {
    state.hands[i % NUM_PLAYERS].push(deck[idx++]);
  }
  state.hands.forEach((h) => h.sort((a, b) => cardOrder(a) - cardOrder(b)));
  state.bids = [null, null, null, null];
  state.tricksWon = [0, 0, 0, 0];
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
  const n = CARDS_PER_ROUND[state.roundIndex] || 1;
  const leadSuit = state.trick.length > 0 ? state.trick[0].s : null;
  const myHand = state.hands[myIndex] || [];
  const legalCards = legalPlays(myHand, leadSuit);
  const trickWithPlayer = (state.trick || []).map((c, i) => ({
    card: c,
    playedBy: (state.trickLeader + i) % NUM_PLAYERS,
  }));
  return {
    gameCode: state.gameCode,
    myIndex,
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
  CARDS_PER_ROUND,
  NUM_PLAYERS,
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
