const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['H', 'D', 'C', 'S'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(rank + suit);
    }
  }
  return deck;
}

function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function rankIndex(card) {
  const r = card.slice(0, card.length - 1);
  const i = RANKS.indexOf(r);
  return i === -1 ? 0 : i + 2;
}

function suit(card) {
  return card.slice(-1);
}

module.exports = { RANKS, SUITS, createDeck, shuffle, rankIndex, suit };
