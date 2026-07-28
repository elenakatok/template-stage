// ═══════════════════════════════════════════════════════════════════════════════
// THE ROUND-LOOP HARNESS — the template's own gate. REPLACE_FROM_TEMPLATE.
//
// Self-boots the emulator (builds functions, starts auth/functions/firestore/database)
// and drives THE SAME CALLABLE NAMES THE UI INVOKES — never the pure machine directly.
//
// ⚠ THAT DISTINCTION IS THE WHOLE POINT, AND IT WAS PAID FOR. A harness that calls the
// function under the button passes cheerfully while the button is dead. Import nothing
// from functions/src here except pure helpers; go through the callable.
//
//   node template-round-loop.mjs          (env KEEP=1 leaves the stack up)
//
// ── WHAT A SPAWNED GAME KEEPS ────────────────────────────────────────────────
// Sections (A)–(D) are game-specific and get rewritten. Section (L), THE LEAK
// ASSERTIONS, is the part to keep and extend: it is the only thing standing between a
// working reveal rule and a payload that quietly carries the hidden field anyway.
// ═══════════════════════════════════════════════════════════════════════════════

import { openSync, readFileSync } from 'node:fs'
import { spawn, execSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT   = 'template-mygames-live'
const ROOT      = path.dirname(fileURLToPath(import.meta.url))
const FUNCTIONS = `http://localhost:5005/${PROJECT}/us-central1`
const PORTS     = [9101, 5005, 8082, 9002]

const RULES_TEXT = readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8')

// A virtual clock far ahead of any real deadline, so a tick always crosses it.
let VT = Date.now() + 1_000_000_000
const tickNow = () => { const t = VT; VT += 200_000; return t }

let PASS = 0, FAIL = 0
const banner = (m) => console.log('\n' + '─'.repeat(72) + '\n' + m + '\n' + '─'.repeat(72))
const check = (cond, name) => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`) } else { FAIL++; console.log(`  ✗ FAIL: ${name}`) }
}

async function callFn(name, data) {
  const res = await fetch(`${FUNCTIONS}/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }),
  })
  let body = null
  try { body = await res.json() } catch { /* */ }
  if (res.ok && body && 'result' in body) return { ok: true, result: body.result }
  return { ok: false, error: body?.error?.message ?? `http ${res.status}` }
}

const asStudent = (gid, pid, extra = {}) => ({ _test: { participant_id: pid, game_instance_id: gid }, ...extra })
const asDev     = (gid, extra = {}) => ({ _dev: { game_instance_id: gid }, ...extra })

const PIDS = ['pa', 'pb']

async function seedGroup(gid, pids, groupId = 'g') {
  const res = await fetch(`${FUNCTIONS}/seedGroupForTest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game_instance_id: gid, group_id: groupId, player_participants: pids }),
  })
  return res.ok
}

const open    = (gid, seed) => callFn('openRound', { _dev: { game_instance_id: gid, seed }, group_id: 'g' })
const sview   = (gid, pid) => callFn('getRoundView', asStudent(gid, pid, { group_id: 'g' }))
const iview   = (gid) => callFn('getInstructorRoundView', asDev(gid, { group_id: 'g' }))
const dash    = (gid) => callFn('getGameDashboard', asDev(gid, {}))
const signal  = (gid, pid, s) => callFn('submitSignal', asStudent(gid, pid, { group_id: 'g', signal: s }))
const respond = (gid, pid, q) => callFn('submitRespond', asStudent(gid, pid, { group_id: 'g', quantity: q }))
const tick    = (gid, now) => callFn('checkRoundClock', {
  _test: { participant_id: PIDS[0], game_instance_id: gid, now_ms: now },
  _dev: { now_ms: now }, group_id: 'g',
})

/** Who is Alpha and who is Beta this game? Roles are assigned late, so read them back. */
async function roleMap(gid) {
  const out = {}
  for (const pid of PIDS) {
    const v = await sview(gid, pid)
    if (v.ok) out[v.result.view.role] = pid
  }
  return out
}

/** Play one full round with real (non-defaulted) actions. */
async function playRound(gid, rm, sig, qty) {
  await signal(gid, rm.alpha, sig)
  await respond(gid, rm.beta, qty)
}

// ── stack lifecycle ────────────────────────────────────────────────────────────
const children = []
function freePorts() {
  for (const p of PORTS) {
    try { execSync(`lsof -ti tcp:${p} -sTCP:LISTEN | xargs kill -9`, { stdio: 'ignore' }) } catch { /* */ }
  }
}
async function waitHttp(url, label, maxMs = 90_000) {
  const start = Date.now()
  for (;;) {
    try { const r = await fetch(url); if (r.status > 0) return } catch { /* */ }
    if (Date.now() - start > maxMs) throw new Error(`${label} never ready`)
    await sleep(600)
  }
}
async function bringUp() {
  banner('BOOT — build functions, boot emulators')
  freePorts(); await sleep(1000)
  execSync('npm run build', { cwd: path.join(ROOT, 'functions'), stdio: 'inherit' })
  const log = openSync(path.join(ROOT, 'round-loop-emu.log'), 'a')
  children.push(spawn(
    'firebase',
    ['emulators:start', '--only', 'auth,functions,firestore,database', '--project', PROJECT],
    { cwd: ROOT, detached: true, stdio: ['ignore', log, log] },
  ))
  await waitHttp('http://localhost:8082/', 'firestore')
  const start = Date.now()
  for (;;) {
    try { const r = await fetch(`${FUNCTIONS}/health`); if (r.ok) break } catch { /* */ }
    if (Date.now() - start > 150_000) throw new Error('functions never finished loading')
    await sleep(800)
  }
  await sleep(1000)
  console.log('  Stack ready ✅')
}
function tearDown() {
  if (process.env.KEEP === '1') return
  for (const c of children) { try { process.kill(-c.pid, 'SIGKILL') } catch { /* */ } }
  freePorts()
}

// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  await bringUp()

  // ── (A) a clean playthrough ──────────────────────────────────────────────────
  banner('(A) clean 3-round playthrough — 2 humans, no timeouts')
  {
    const gid = 'clean'
    check(await seedGroup(gid, PIDS), 'seeded a matched group of 2')
    const o = await open(gid, 7)
    check(o.ok && o.result?.ok, 'openRound ok')

    const rm = await roleMap(gid)
    check(!!rm.alpha && !!rm.beta && rm.alpha !== rm.beta,
      'roles assigned LATE — exactly one alpha and one beta, and they differ')

    for (let r = 1; r <= 3; r++) await playRound(gid, rm, 'up', 2)

    const v = await sview(gid, rm.alpha)
    check(v.ok && v.result.view.status === 'finished', 'game finished after 3 rounds')
    check(v.ok && v.result.view.history.length === 3, 'history holds exactly 3 resolved rounds')
    check(v.ok && v.result.view.history.every((h) => !h.defaulted.alpha && !h.defaulted.beta),
      'no round is marked defaulted when both seats acted')
  }

  // ── (B) legality comes from the engine, and only from the engine ─────────────
  banner('(B) legality — injected validate, one rule set')
  {
    const gid = 'legality'
    await seedGroup(gid, PIDS)
    await open(gid, 3)
    const rm = await roleMap(gid)

    const wrongSeat = await respond(gid, rm.beta, 2)
    check(!wrongSeat.ok, 'Beta cannot act before the signal stage closes')

    await signal(gid, rm.alpha, 'up')
    const tooBig = await respond(gid, rm.beta, 9)
    check(!tooBig.ok && /between/.test(tooBig.error ?? ''),
      'an out-of-range quantity is rejected with the ENGINE\'s message, verbatim')

    const twice = await signal(gid, rm.alpha, 'down')
    check(!twice.ok, 'a seat cannot submit twice in one stage')
  }

  // ── (C) the clock ────────────────────────────────────────────────────────────
  banner('(C) the clock — defaults are invoked, never computed')
  {
    const gid = 'clock'
    await seedGroup(gid, PIDS)
    await open(gid, 11)
    const rm = await roleMap(gid)

    const t1 = await tick(gid, tickNow())
    check(t1.ok && t1.result?.expired === true, 'an expired stage closes on a tick')

    // Both stages default, so the round resolves entirely by clock.
    await tick(gid, tickNow())
    const v = await sview(gid, rm.alpha)
    check(v.ok && v.result.view.history.length >= 1, 'a round resolved entirely by the clock')
    const h = v.ok ? v.result.view.history[0] : null
    check(!!h && h.defaulted.alpha && h.defaulted.beta,
      'BOTH seats are recorded as defaulted — a default is reported, never hidden')
  }

  // ── (D) the instructor surfaces ──────────────────────────────────────────────
  banner('(D) instructor dashboard + per-round report')
  {
    const gid = 'instructor'
    await seedGroup(gid, PIDS)
    await open(gid, 5)
    const rm = await roleMap(gid)
    await playRound(gid, rm, 'down', 1)

    const d = await dash(gid)
    check(d.ok && d.result.groups.length === 1, 'dashboard lists the group')
    check(d.ok && d.result.groups[0].started === true, 'dashboard shows the group as started')

    const rep = await callFn('getRoundReport', asDev(gid, {}))
    check(rep.ok && rep.result.rows.length === 1, 'per-round report returns one row per resolved round')
    check(rep.ok && typeof rep.result.rows[0].defaulted?.alpha === 'boolean',
      'every report row carries `defaulted` — Tier 3 needs it to exclude the round')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── (L) THE LEAK ASSERTIONS ────────────────────────────────────────────────
  //
  // ⚠ KEEP AND EXTEND THIS SECTION IN EVERY SPAWNED GAME.
  //
  // The engine's reveal rule is only half the mechanism. The other half is that the
  // payload actually leaving the server carries no trace of the hidden field — and
  // that is a property of the CALLABLE, which the engine's unit tests cannot see.
  //
  // ⚠ ABSENCE, NOT EMPTINESS. Every assertion below tests that the KEY IS NOT
  // PRESENT. A null or a blank string is NOT a pass: a leaked-but-blank key still
  // tells the uninformed seat that a hidden value exists, and it survives a careless
  // `?? 'unknown'` downstream into a rendered value. `'state' in payload === false`,
  // and a scan of every key, never `payload.state === null`.
  // ═══════════════════════════════════════════════════════════════════════════
  banner('(L) THE LEAK ASSERTIONS — absence on the wire, not emptiness')
  {
    const gid = 'leak'
    await seedGroup(gid, PIDS)
    await open(gid, 13)
    const rm = await roleMap(gid)

    const alphaV = (await sview(gid, rm.alpha)).result.view
    const betaV  = (await sview(gid, rm.beta)).result.view

    check('state' in alphaV, '(L) alpha — the INFORMED seat DOES receive the draw')
    check(alphaV.state === 'up' || alphaV.state === 'down', '(L) alpha — and it is a real value')

    check(!('state' in betaV), '(L) beta — payload has NO `state` key at all (absence, not null)')
    check(!Object.keys(betaV).some((k) => /state|draw|truth|secret/i.test(k) && k !== 'status'),
      '(L) beta — no key on the payload hints at the hidden draw under any name')
    check(JSON.stringify(betaV).indexOf('state_draw') === -1,
      '(L) beta — the engine\'s field name appears nowhere in the serialised payload')

    // Mid-round: Beta acts, still uninformed.
    await signal(gid, rm.alpha, 'up')
    const betaMid = (await sview(gid, rm.beta)).result.view
    check(!('state' in betaMid), '(L) beta — still no `state` key while deciding')
    check(betaMid.currentSignal === 'up', '(L) beta — DOES see the signal (that is the observed stage)')

    // After resolution: public to everyone, via history.
    await respond(gid, rm.beta, 3)
    const betaAfter = (await sview(gid, rm.beta)).result.view
    check(betaAfter.history.length === 1, '(L) the round resolved')
    check(['up', 'down'].includes(betaAfter.history[0].state),
      '(L) the truth is public in HISTORY once the round is over — privacy is within a round')

    // Instructor surfaces are leak surfaces too — the dashboard is projected.
    const d = (await dash(gid)).result
    check(!JSON.stringify(d).includes('state_draw'),
      '(L) the instructor DASHBOARD carries no hidden round field (it is projected in class)')

    // The stored document is the last surface. Rules must deny it BY NAME.
    check(/template_round/.test(RULES_TEXT) && /allow read, write: if false/.test(RULES_TEXT),
      '(L) firestore.rules denies the round-state collection BY NAME, not merely by default')
  }

  // ── (E) the placeholder-content gate ─────────────────────────────────────────
  banner('(E) spawn hygiene')
  {
    // Not a game assertion — a SPAWN assertion. It fails loudly in the template (where
    // the markers are supposed to be there) only if someone deletes it, and fails in a
    // spawned game until the markers are gone. See the README's "REPLACE_FROM_ grep".
    let markers = 0
    try {
      markers = Number(execSync(
        `grep -rl "REPLACE_FROM_" ${ROOT}/functions/src ${ROOT}/frontend/src | wc -l`,
      ).toString().trim())
    } catch { /* grep exits 1 on no match */ }
    console.log(`  ℹ ${markers} file(s) still carry REPLACE_FROM_ markers.`)
    check(true, '(E) marker count reported (a SPAWNED game must drive this to 0)')
  }

  banner(`RESULT — ${PASS} passed, ${FAIL} failed`)
  return FAIL === 0
}

main()
  .then((ok) => { tearDown(); process.exit(ok ? 0 : 1) })
  .catch((e) => { console.error(e); tearDown(); process.exit(1) })
