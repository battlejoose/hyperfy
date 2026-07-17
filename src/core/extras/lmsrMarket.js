/**
 * Custodial multi-outcome LMSR helpers.
 * Cost(q) = b * ln(sum_i exp(q_i / b))  (numerically stabilized)
 * Units: b and cost/proceeds are in SOL; q is dimensionless share quantity.
 */

function cloneQ(qMap) {
  return new Map(qMap)
}

/** LMSR cost in SOL for the current quantity vector. */
export function lmsrCost(qMap, outcomeIds, b) {
  if (!outcomeIds.length || !(b > 0)) return 0
  let max = -Infinity
  for (const id of outcomeIds) {
    const v = (qMap.get(id) || 0) / b
    if (v > max) max = v
  }
  let sum = 0
  for (const id of outcomeIds) {
    sum += Math.exp((qMap.get(id) || 0) / b - max)
  }
  return b * (Math.log(sum) + max)
}

/** Implied probabilities per outcome. */
export function lmsrProbs(qMap, outcomeIds, b) {
  const out = {}
  if (!outcomeIds.length || !(b > 0)) {
    for (const id of outcomeIds) out[id] = 0
    return out
  }
  let max = -Infinity
  for (const id of outcomeIds) {
    const v = (qMap.get(id) || 0) / b
    if (v > max) max = v
  }
  let sum = 0
  const exps = {}
  for (const id of outcomeIds) {
    exps[id] = Math.exp((qMap.get(id) || 0) / b - max)
    sum += exps[id]
  }
  for (const id of outcomeIds) {
    out[id] = sum > 0 ? exps[id] / sum : 0
  }
  return out
}

/** SOL cost to buy `delta` shares of pickId (>0). */
export function buyCostSol(qMap, outcomeIds, b, pickId, delta) {
  if (!(delta > 0)) return 0
  const before = lmsrCost(qMap, outcomeIds, b)
  const next = cloneQ(qMap)
  next.set(pickId, (next.get(pickId) || 0) + delta)
  return lmsrCost(next, outcomeIds, b) - before
}

/** SOL proceeds from selling `delta` shares of pickId (>0). */
export function sellProceedsSol(qMap, outcomeIds, b, pickId, delta) {
  if (!(delta > 0)) return 0
  const before = lmsrCost(qMap, outcomeIds, b)
  const next = cloneQ(qMap)
  next.set(pickId, (next.get(pickId) || 0) - delta)
  return before - lmsrCost(next, outcomeIds, b)
}

/**
 * Largest share delta purchasable for at most budgetSol (binary search).
 */
export function sharesForBuyBudget(qMap, outcomeIds, b, pickId, budgetSol) {
  if (!(budgetSol > 0)) return 0
  let lo = 0
  let hi = Math.max(budgetSol / Math.max(b, 1e-9), budgetSol) + 1
  // Expand until cost exceeds budget
  for (let i = 0; i < 40 && buyCostSol(qMap, outcomeIds, b, pickId, hi) < budgetSol; i++) {
    hi *= 2
  }
  for (let i = 0; i < 56; i++) {
    const mid = (lo + hi) / 2
    if (buyCostSol(qMap, outcomeIds, b, pickId, mid) <= budgetSol) lo = mid
    else hi = mid
  }
  return lo
}

/** Apply a buy: mutates qMap, returns { shares, costSol }. */
export function applyBuy(qMap, outcomeIds, b, pickId, budgetSol) {
  const shares = sharesForBuyBudget(qMap, outcomeIds, b, pickId, budgetSol)
  if (!(shares > 0)) return { shares: 0, costSol: 0 }
  const costSol = buyCostSol(qMap, outcomeIds, b, pickId, shares)
  qMap.set(pickId, (qMap.get(pickId) || 0) + shares)
  return { shares, costSol }
}

/** Apply a sell: mutates qMap, returns { shares, proceedsSol }. */
export function applySell(qMap, outcomeIds, b, pickId, shares) {
  const outstanding = qMap.get(pickId) || 0
  const delta = Math.min(Math.max(0, shares), outstanding)
  if (!(delta > 0)) return { shares: 0, proceedsSol: 0 }
  const proceedsSol = sellProceedsSol(qMap, outcomeIds, b, pickId, delta)
  qMap.set(pickId, outstanding - delta)
  return { shares: delta, proceedsSol }
}

/** Exit value in SOL for a player's share holding (mark-to-market sell). */
export function positionExitValueSol(qMap, outcomeIds, b, pickId, shares) {
  return sellProceedsSol(qMap, outcomeIds, b, pickId, shares)
}

/**
 * LMSR Δq such that buying that many shares of any outcome on an empty market
 * costs ~`budgetSol` (the min buy). That quantity is defined as **1 share**.
 */
export function starterShareUnit(outcomeIds, b, budgetSol) {
  if (!outcomeIds?.length || !(b > 0) || !(budgetSol > 0)) return 1
  const empty = new Map()
  for (const id of outcomeIds) empty.set(id, 0)
  const unit = sharesForBuyBudget(empty, outcomeIds, b, outcomeIds[0], budgetSol)
  return unit > 0 ? unit : 1
}

/**
 * Bet-value index: cost of **1 share now** vs cost of the **first share** on an empty
 * market (that first share = 100%). Share unit is sized so open cost ≈ min buy.
 */
export function oneShareValuePercents(qMap, outcomeIds, b, shareUnit) {
  const empty = new Map()
  for (const id of outcomeIds) empty.set(id, 0)
  const out = {}
  const unit = shareUnit > 0 ? shareUnit : 1
  for (const id of outcomeIds) {
    const first = buyCostSol(empty, outcomeIds, b, id, unit)
    const next = buyCostSol(qMap, outcomeIds, b, id, unit)
    out[id] = first > 0 ? Math.round((100 * next) / first) : 100
  }
  return out
}
