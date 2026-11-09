/**
 * Where a player's P/L came from: direction or time value.
 *
 * Plain arithmetic on the blotter, no model. Every option fill splits into the
 * part of its price that was already in the money (intrinsic) and the rest
 * (extrinsic, the time value), measured against the future's mark at the moment
 * it traded:
 *
 *   extrinsic = qty × ((value now − intrinsic now) − (price − intrinsic at trade))
 *   intrinsic = qty × (intrinsic now − intrinsic at trade)
 *   futures   = qty × (mark now − entry)
 *
 * qty is signed (+ bought, − sold). "Now" is the expiry for a contract that has
 * settled — value and intrinsic are then the same number, so the extrinsic term
 * is just the time value collected or paid — and the current mark for one that
 * is still open. Intrinsic + extrinsic is exactly the option's own P/L.
 *
 * Direction is futures + option intrinsic; time value is option extrinsic.
 *
 * The one judgement in here: futures handed over by an exercise enter at the
 * future's mark at expiry, not at the strike. The strike-to-expiry gap is the
 * option finishing in the money, and it is already counted as that option's
 * intrinsic; what happens to those futures after expiry is futures P/L like any
 * other. Booking them at the strike would count the gap twice. The totals still
 * tie out to the game's own P/L to the cent — the test suite checks it.
 */
import { contractKey, intrinsic, markedAt } from './options.js';

/** The future's mark going into `round`, which is what an auction in that round traded against. */
function markInto(game, round) {
  if (round <= 1) return game.config.openingPrice;
  return game.history.find((h) => h.round === round - 1)?.mark ?? game.mark;
}

/** The future's mark once `round`'s dice settled, which is what that round's expiry settled against. */
function markAfter(game, round) {
  return game.history.find((h) => h.round === round)?.mark ?? game.mark;
}

/**
 * The totals, and — with `lines` — the trade-by-trade working behind them, which
 * is what the player's own breakdown shows. The totals alone are what the wall
 * gets.
 */
export function attribution(game, p, { lines: withLines = false } = {}) {
  const lines = [];
  let futures = 0;
  for (const f of p.fills) {
    const entry = f.exercise ? (f.exercise.settle ?? markAfter(game, f.round)) : f.price;
    const v = f.qty * (game.mark - entry);
    futures += v;
    lines.push(f.exercise
      ? { type: 'exercise', round: f.round, qty: f.qty, strike: f.exercise.strike,
          optKind: f.exercise.kind, entry, mark: game.mark, futures: v }
      : { type: 'future', round: f.round, qty: f.qty, price: f.price, mark: game.mark, futures: v });
  }

  let intr = 0, ext = 0;
  if (game.options) {
    const marks = new Map(Object.entries(game.options.marks));
    const settled = new Map((p.settledOptions ?? []).map((s) => [contractKey(s), s]));
    for (const l of p.optionLog ?? []) {
      const under = l.underlying ?? markInto(game, l.round);
      const i0 = intrinsic(l.kind, l.strike, under);
      const done = settled.get(contractKey(l));
      const iNow = done ? done.mark : intrinsic(l.kind, l.strike, game.mark);
      const vNow = done ? done.mark : markedAt(l, marks, game.mark);
      const di = l.qty * (iNow - i0);
      const de = l.qty * ((vNow - iNow) - (l.premium - i0));
      intr += di;
      ext += de;
      lines.push({
        type: 'option', round: l.round, qty: l.qty, kind: l.kind, strike: l.strike, expiry: l.expiry,
        price: l.premium, underlying: under, i0, iNow, vNow, settled: !!done,
        intrinsic: di, extrinsic: de,
      });
    }
  }
  lines.sort((a, b) => a.round - b.round);

  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    futures: round2(futures),
    intrinsic: round2(intr),
    extrinsic: round2(ext),
    direction: round2(futures + intr),
    timeValue: round2(ext),
    ...(withLines ? { lines } : {}),
  };
}
