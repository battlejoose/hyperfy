const MAX_CORPSES = 50
const MAX_BLOOD_HITS = 200

export function createArenaRemnants() {
  return { corpses: [], blood: [] }
}

export function addArenaCorpse(state, { p, q, sessionAvatar }) {
  if (!Array.isArray(p) || !Array.isArray(q)) return
  state.corpses.push({ p, q, sessionAvatar })
  while (state.corpses.length > MAX_CORPSES) {
    state.corpses.shift()
  }
}

export function addArenaBloodHit(state, p) {
  if (!Array.isArray(p) || p.length !== 3 || p.some(v => typeof v !== 'number' || !Number.isFinite(v))) return
  state.blood.push({ p })
  while (state.blood.length > MAX_BLOOD_HITS) {
    state.blood.shift()
  }
}

export function serializeArenaRemnants(state) {
  return {
    corpses: state.corpses,
    blood: state.blood,
  }
}

export function clearArenaRemnants(state) {
  state.corpses.length = 0
  state.blood.length = 0
}
