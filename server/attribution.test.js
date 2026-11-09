import test from 'node:test';
import assert from 'node:assert/strict';

import { createGame, addBot, startGame, lockRoll, publicState, privateState } from './game.js';
import { attribution } from './attribution.js';

/** A seeded rng, so a failing table can be replayed. */
const seeded = (seed) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

function playBots(seed, config) {
  const rng = seeded(seed);
  const g = createGame('ATTR', config);
  addBot(g); addBot(g); addBot(g); addBot(g);
  startGame(g, rng);
  let guard = 0;
  while (g.phase !== 'complete' && guard++ < 200) {
    if (g.phase !== 'rolling') throw new Error(`stalled in ${g.phase}`);
    lockRoll(g, rng);
  }
  return g;
}

test('direction + time value ties out to every player\'s P/L, game after game', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = playBots(seed, {
      maxRounds: 5, options: true, optionRules: { fixedExpiries: [2, 4, 5] },
    });
    assert.equal(g.phase, 'complete');
    for (const p of g.players) {
      const a = attribution(g, p);
      const pl = privateState(g, p.id).me.pl;
      assert.ok(Math.abs(a.direction + a.timeValue - pl) < 0.01,
        `seed ${seed} ${p.name}: ${a.direction} + ${a.timeValue} vs ${pl}`);
      assert.ok(Math.abs(a.futures + a.intrinsic - a.direction) < 0.01);
    }
  }
});

test('it ties out mid-game too, with contracts still open', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = seeded(seed);
    const g = createGame('ATTR', { maxRounds: 5, options: true, optionRules: { fixedExpiries: [3, 5] } });
    addBot(g); addBot(g); addBot(g);
    startGame(g, rng);
    for (let i = 0; i < 4; i++) lockRoll(g, rng);   // one round settled, R3 and R5 still open
    for (const p of g.players) {
      const a = attribution(g, p);
      assert.ok(Math.abs(a.direction + a.timeValue - privateState(g, p.id).me.pl) < 0.01, `seed ${seed}`);
    }
  }
});

test('the futures-only game is all direction', () => {
  const g = playBots(7, { maxRounds: 3 });
  for (const p of g.players) {
    const a = attribution(g, p);
    assert.equal(a.timeValue, 0);
    assert.equal(a.intrinsic, 0);
  }
});

test('the recap is public only once the game is over', () => {
  const g = playBots(3, { maxRounds: 3, options: true, optionRules: { fixedExpiries: [3] } });
  const recap = publicState(g).recap;
  assert.equal(Object.keys(recap).length, 4);

  const live = createGame('LIVE', { options: true });
  addBot(live);
  startGame(live, seeded(1));
  assert.equal(publicState(live).recap, null);
});

test('Ana, worked by hand: sold calls that finished in the money, kept the futures', () => {
  // The worked example from the design canvas. Future 100 → 101 → 104 → 107 → 110.
  const g = {
    config: { openingPrice: 100 },
    mark: 110,
    history: [{ round: 1, mark: 101 }, { round: 2, mark: 104 }, { round: 3, mark: 107 }, { round: 4, mark: 110 }],
    options: { marks: {} },
  };
  const ana = {
    fills: [
      { round: 1, qty: 2, price: 101 },
      { round: 3, qty: -3, price: 105, exercise: { kind: 'call', strike: 105, expiry: 3, contracts: -3, settle: 107 } },
    ],
    optionLog: [
      { round: 2, kind: 'call', strike: 105, expiry: 3, qty: -3, premium: 6, underlying: 104 },
      { round: 2, kind: 'put', strike: 104, expiry: 3, qty: 2, premium: 5, underlying: 104 },
    ],
    settledOptions: [
      { round: 3, kind: 'call', strike: 105, expiry: 3, qty: -3, mark: 2 },
      { round: 3, kind: 'put', strike: 104, expiry: 3, qty: 2, mark: 0 },
    ],
  };
  assert.deepEqual(attribution(g, ana), {
    futures: 9, intrinsic: -6, extrinsic: 8, direction: 3, timeValue: 8,
  });
});
