const { rankIndex, suit } = require('./cards');

function getRankIndices(cards) {
  return cards.map((c) => rankIndex(c));
}

function getSuits(cards) {
  return cards.map((c) => suit(c));
}

function isFlush(cards) {
  if (cards.length < 5) return false;
  const suits = getSuits(cards);
  const s = suits[0];
  return suits.every((x) => x === s);
}

function isStraight(rankIndices) {
  const r = [...new Set(rankIndices)].sort((a, b) => b - a);
  if (r.length < 5) return null;
  for (let i = 0; i <= r.length - 5; i++) {
    const slice = r.slice(i, i + 5);
    if (slice[0] - slice[4] === 4) return slice;
  }
  if (r.includes(14)) {
    const low = [...r.filter((x) => x !== 14), 1].sort((a, b) => b - a);
    if (low.length >= 5 && low[0] === 5 && low[4] === 1) return [5, 4, 3, 2, 1];
    for (let i = 0; i <= low.length - 5; i++) {
      const slice = low.slice(i, i + 5);
      if (slice[0] - slice[4] === 4) return slice;
    }
  }
  return null;
}

function countRanks(cards) {
  const counts = {};
  for (const c of cards) {
    const r = rankIndex(c);
    counts[r] = (counts[r] || 0) + 1;
  }
  return counts;
}

function bestFiveFromSeven(cards) {
  if (cards.length < 5) return null;
  if (cards.length === 5) return rankHand(cards);
  let best = null;
  function choose(start, chosen) {
    if (chosen.length === 5) {
      const hand = chosen.map((i) => cards[i]);
      const r = rankHand(hand);
      if (!best || compareRank(r, best) > 0) best = r;
      return;
    }
    for (let i = start; i < cards.length; i++) {
      choose(i + 1, chosen.concat([i]));
    }
  }
  choose(0, []);
  return best;
}

function rankHand(fiveCards) {
  if (fiveCards.length !== 5) return null;
  const indices = getRankIndices(fiveCards).sort((a, b) => b - a);
  const suits = getSuits(fiveCards);
  const flush = suits.every((s) => s === suits[0]);
  const straightRun = isStraight(indices);

  if (flush && straightRun) {
    return { type: 9, values: straightRun };
  }
  const counts = countRanks(fiveCards);
  const entries = Object.entries(counts).map(([k, v]) => [parseInt(k, 10), v]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const quad = entries.find((e) => e[1] === 4);
  const trip = entries.find((e) => e[1] === 3);
  const pair = entries.find((e) => e[1] === 2);
  const pairs = entries.filter((e) => e[1] === 2);

  if (quad) {
    const kicker = entries.find((e) => e[0] !== quad[0])[0];
    return { type: 8, values: [quad[0], kicker] };
  }
  if (trip && pair) {
    return { type: 7, values: [trip[0], pair[0]] };
  }
  if (flush) {
    return { type: 6, values: [...indices] };
  }
  if (straightRun) {
    return { type: 5, values: straightRun };
  }
  if (trip) {
    const kickers = entries.filter((e) => e[0] !== trip[0]).map((e) => e[0]).sort((a, b) => b - a).slice(0, 2);
    return { type: 4, values: [trip[0], ...kickers] };
  }
  if (pairs.length >= 2) {
    const [p1, p2] = pairs.sort((a, b) => b[0] - a[0]);
    const kicker = entries.find((e) => e[0] !== p1[0] && e[0] !== p2[0])[0];
    return { type: 3, values: [p1[0], p2[0], kicker] };
  }
  if (pair) {
    const kickers = entries.filter((e) => e[0] !== pair[0]).map((e) => e[0]).sort((a, b) => b - a).slice(0, 3);
    return { type: 2, values: [pair[0], ...kickers] };
  }
  return { type: 1, values: [...indices] };
}

function compareRank(a, b) {
  if (a.type !== b.type) return a.type - b.type;
  for (let i = 0; i < Math.max(a.values.length, b.values.length); i++) {
    const va = a.values[i] || 0;
    const vb = b.values[i] || 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

const RANK_NAMES = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

const HAND_TYPE_NAMES = {
  1: 'Højeste kort',
  2: 'Par',
  3: 'To par',
  4: 'Triss',
  5: 'Straight',
  6: 'Flush',
  7: 'Fuldt hus',
  8: 'Fire ens',
  9: 'Straight flush',
};

function describeHand(rankResult) {
  if (!rankResult) return { handName: '–', description: '' };
  const name = HAND_TYPE_NAMES[rankResult.type] || 'Hånd';
  let desc = '';
  if (rankResult.type === 9) desc = rankResult.values[0] === 14 ? 'Kongelig' : `højeste ${RANK_NAMES[rankResult.values[0]] || rankResult.values[0]}`;
  else if (rankResult.type === 8) desc = `4 × ${RANK_NAMES[rankResult.values[0]] || rankResult.values[0]}`;
  else if (rankResult.type === 7) desc = `${RANK_NAMES[rankResult.values[0]] || ''} over ${RANK_NAMES[rankResult.values[1]] || ''}`;
  else if (rankResult.type === 6) desc = `højeste ${RANK_NAMES[rankResult.values[0]] || rankResult.values[0]}`;
  else if (rankResult.type === 5) desc = `til ${RANK_NAMES[rankResult.values[0]] || rankResult.values[0]}`;
  else if (rankResult.type === 4) desc = `3 × ${RANK_NAMES[rankResult.values[0]] || rankResult.values[0]}`;
  else if (rankResult.type === 3) desc = `${RANK_NAMES[rankResult.values[0]] || ''} og ${RANK_NAMES[rankResult.values[1]] || ''}`;
  else if (rankResult.type === 2) desc = `${RANK_NAMES[rankResult.values[0]] || rankResult.values[0]}`;
  else if (rankResult.type === 1 && rankResult.values[0]) desc = RANK_NAMES[rankResult.values[0]] || '';
  return { handName: name, description: desc.trim() };
}

function getShowdownHandInfos(cardsPerPlayer) {
  return cardsPerPlayer.map((cards) => {
    const rank = bestFiveFromSeven(cards);
    const { handName, description } = describeHand(rank);
    return { handName, description };
  });
}

function findWinners(cardsPerPlayer) {
  const ranked = cardsPerPlayer.map((cards) => bestFiveFromSeven(cards));
  let best = ranked[0];
  const winners = [0];
  for (let i = 1; i < ranked.length; i++) {
    const c = compareRank(ranked[i], best);
    if (c > 0) {
      best = ranked[i];
      winners.length = 0;
      winners.push(i);
    } else if (c === 0) {
      winners.push(i);
    }
  }
  return winners;
}

module.exports = { rankHand, bestFiveFromSeven, compareRank, findWinners, describeHand, getShowdownHandInfos, HAND_TYPE_NAMES };
