// ═══════════════════════════════════════════════════════════════════════════════
// THE END-TO-END HARNESS — empty instance to a landed gradebook push.
//
// ⚠ WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM THE ROUND-LOOP HARNESS.
//
// The round-loop harness starts every section from `seedGroupForTest`, which writes an
// already-MATCHED group. That is right for testing the engine and wrong for testing the
// game: it skips the entire pre-game flow, so the harness was 28/28 green while
// production shipped twice broken —
//
//   1. `triggerMatching` was never exported. Match Now failed with a bare "internal".
//   2. Nothing invoked `startAllGroups`. Groups matched and then dead-ended, with no
//      start control on any screen.
//
// Both were reachability failures, not logic failures. The functions were correct; one
// did not exist and one could not be reached. A harness that seeds past the flow cannot
// see either.
//
// ── THE RULE THIS FILE ENFORCES ──────────────────────────────────────────────
// NO SEED SHORTCUTS. Every step below calls the SAME callable the shared UI invokes, in
// the SAME order a human causes it. `seedGroupForTest` and `seedRosterForTest` are not
// imported here, on purpose. The only concession to the emulator is participant
// bootstrap via `_test`, which is how the real client authenticates there too.
//
// A harness that calls the function UNDER the button can pass while the button is dead.
// This one walks the buttons.
//
//   node template-e2e.mjs        (env KEEP=1 leaves the stack up)
// ═══════════════════════════════════════════════════════════════════════════════

import { openSync } from 'node:fs'
import { spawn, execSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT   = 'template-mygames-live'
const ROOT      = path.dirname(fileURLToPath(import.meta.url))
const FUNCTIONS = `http://localhost:5005/${PROJECT}/us-central1`
const PORTS     = [9101, 5005, 8082, 9002]
const CB_PORT   = 5599
const RTDB_NS   = `${PROJECT}-default-rtdb`

let PASS = 0, FAIL = 0
const banner = (m) => console.log('\n' + '─'.repeat(72) + '\n' + m + '\n' + '─'.repeat(72))
const check = (c, n) => { if (c) { PASS++; console.log(`  ✓ ${n}`) } else { FAIL++; console.log(`  ✗ FAIL: ${n}`) } }

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

// ── the mock classroom (roster source + gradebook sink) ────────────────────────
let cbServer = null
let pushed = []
let rosterRequests = 0
// The shape makeSyncRoster destructures. Getting this wrong is not a harness detail:
// it is exactly what the real classroom returns, and the first run failed on it.
const ROSTER = [
  { participant_id: 'stu1', name: 'Ada Lovelace',    email: 'ada@example.edu',   external_id: 'stu1' },
  { participant_id: 'stu2', name: 'Alan Turing',     email: 'alan@example.edu',  external_id: 'stu2' },
  { participant_id: 'stu3', name: 'Grace Hopper',    email: 'grace@example.edu', external_id: 'stu3' },
  { participant_id: 'stu4', name: 'Edsger Dijkstra', email: 'ed@example.edu',    external_id: 'stu4' },
]
function startClassroom() {
  return new Promise((res) => {
    cbServer = http.createServer((req, r) => {
      let b = ''
      req.on('data', (c) => (b += c))
      req.on('end', () => {
        // One endpoint serves both roles; the game calls different URLs but the mock
        // answers by shape, which keeps this file short without faking anything real.
        let parsed = null
        try { parsed = JSON.parse(b) } catch { /* */ }
        r.writeHead(200, { 'Content-Type': 'application/json' })
        if (parsed && parsed.participant_id !== undefined) { pushed.push(parsed); r.end('{"ok":true}'); return }
        rosterRequests++
        r.end(JSON.stringify({ participants: ROSTER, instructor_email: 'prof@example.edu' }))
      })
    })
    cbServer.listen(CB_PORT, '127.0.0.1', res)
  })
}
const CB = `http://localhost:${CB_PORT}`

// ── stack ──────────────────────────────────────────────────────────────────────
const children = []
const freePorts = () => { for (const p of PORTS) { try { execSync(`lsof -ti tcp:${p} -sTCP:LISTEN | xargs kill -9`, { stdio: 'ignore' }) } catch { /* */ } } }
async function bringUp() {
  banner('BOOT — build functions, boot emulators, start the mock classroom')
  freePorts(); await sleep(1000)
  execSync('npm run build', { cwd: path.join(ROOT, 'functions'), stdio: 'inherit' })
  const log = openSync(path.join(ROOT, 'e2e-emu.log'), 'a')
  children.push(spawn('firebase',
    ['emulators:start', '--only', 'auth,functions,firestore,database', '--project', PROJECT],
    { cwd: ROOT, detached: true, stdio: ['ignore', log, log] }))
  const start = Date.now()
  for (;;) {
    try { const r = await fetch(`${FUNCTIONS}/health`); if (r.ok) break } catch { /* */ }
    if (Date.now() - start > 150_000) throw new Error('functions never came up')
    await sleep(800)
  }
  await startClassroom()
  await sleep(800)
  console.log('  Stack ready ✅')
}
const tearDown = () => {
  if (cbServer) { try { cbServer.close() } catch { /* */ } }
  if (process.env.KEEP === '1') return
  for (const c of children) { try { process.kill(-c.pid, 'SIGKILL') } catch { /* */ } }
  freePorts()
}

// ═══════════════════════════════════════════════════════════════════════════════
// The steps, each named for the BUTTON a human presses.
// ═══════════════════════════════════════════════════════════════════════════════

/** Instructor: "Sync roster". */
const syncRoster = (gid) => callFn('syncRoster',
  { _dev: { game_instance_id: gid, roster_url: CB, callback_secret: 'test' } })

/** Instructor: "Generate attendance code". */
const genCode = (gid) => callFn('generateAttendanceCode', asDev(gid, {}))

/** Student: opening the launch link. */
const assignRole = (gid, pid) => callFn('assignRole', asStudent(gid, pid, {}))

/** Student: the knowledge check, prep, ready, attendance code. */
async function studentPreGame(gid, pid, code) {
  const out = {}
  out.kcQuestions = await callFn('getStudentPrepQuestions', asStudent(gid, pid, {}))
  // The late-assignment gate: the correct answer IS the single matching role key.
  // `answers: {}` is rejected — the first run failed on it, which is the point of
  // driving the real callable rather than a convenient stand-in.
  out.kc = await callFn('submitKnowledgeCheck', asStudent(gid, pid, { answer: 'player' }))
  out.prep = await callFn('completePrep', asStudent(gid, pid, {}))
  out.ready = await callFn('confirmReady', asStudent(gid, pid, {}))
  out.attend = await callFn('verifyAttendanceCode', asStudent(gid, pid, { code }))
  return out
}

/**
 * Student presence, written straight to RTDB.
 *
 * ⚠ NOT A SEED SHORTCUT — this is what the STUDENT'S BROWSER does. `useStudentSession`
 * writes `presence/{instance}/{participant}` directly; there is no callable for it,
 * because presence has to disappear when the tab closes. The matcher's eligibility gate
 * is `attended AND valid role AND PRESENT`, so a harness that skips this is testing a
 * matcher that can never match, which is how the first run of this file "failed".
 */
async function beOnThePage(gid, pid) {
  // Two things that both fail SILENTLY-ish if you get them wrong, and both did here:
  //
  //   ns=   the emulator namespace is the RTDB INSTANCE id, `<project>-default-rtdb`
  //         (see VITE_FIREBASE_DATABASE_URL). The bare project id writes to a different
  //         namespace that nothing reads — and returns 200.
  //   auth  database.rules.json requires `auth.token.game_instance_id == $instanceId`
  //         (the FERPA instance-claim pattern), so an unauthenticated REST write is
  //         DENIED — correctly. The emulator's admin override is the
  //         `Authorization: Bearer owner` HEADER; the `?auth=owner` QUERY PARAM does NOT
  //         work and is also denied, which is a confusing hour if you assume otherwise.
  //         This stands in for the signed-in browser session the harness has no way to
  //         hold. The rule itself is not relaxed — the round-loop harness asserts it.
  // ⚠ WRITE TO BOTH NAMESPACES. The RTDB emulator namespace the ADMIN SDK uses is not
  // reliably `<project>-default-rtdb`: it depends on whether a databaseURL is configured,
  // and it differs between a spawned game and the template (whose .firebaserc still
  // carries its identity marker). Writing to one and having the server read the other
  // fails with a 200 and an empty presence set — which surfaces as "not enough
  // participants to form a group", pointing at matching rather than at the harness.
  // Writing both is harmless and removes the guesswork.
  const results = await Promise.all([`${PROJECT}-default-rtdb`, PROJECT].map((ns) =>
    fetch(`http://localhost:9002/presence/${gid}/${pid}.json?ns=${ns}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: 'true',
    }).then((r) => r.ok).catch(() => false),
  ))
  return results.some(Boolean)
}

const matchNow      = (gid) => callFn('triggerMatching', asDev(gid, {}))
const startClass    = (gid) => callFn('startAllGroups', asDev(gid, {}))
const dashboard     = (gid) => callFn('getGameDashboard', asDev(gid, {}))
const roundView     = (gid, pid, g) => callFn('getRoundView', asStudent(gid, pid, { group_id: g }))
const submitSignal  = (gid, pid, g, s) => callFn('submitSignal', asStudent(gid, pid, { group_id: g, signal: s }))
const submitRespond = (gid, pid, g, q) => callFn('submitRespond', asStudent(gid, pid, { group_id: g, quantity: q }))

/** Instructor: "Score & Record" — the button that pushes to the gradebook. */
const scoreAndRecord = (gid) => callFn('scoreAndRecord',
  { _dev: { game_instance_id: gid, callback_url: CB, callback_secret: 'test' } })

/** Play one round for a group, whoever holds which seat. */
async function playRound(gid, groupId, pids) {
  for (const pid of pids) {
    const v = await roundView(gid, pid, groupId)
    if (!v.ok) continue
    const { owes, role } = v.result.view
    if (owes === 'signal') await submitSignal(gid, pid, groupId, role === 'retailer' ? 'up' : 'up')
    else if (owes === 'respond') await submitRespond(gid, pid, groupId, 2)
  }
  // second pass: the stage that opened when the first closed
  for (const pid of pids) {
    const v = await roundView(gid, pid, groupId)
    if (!v.ok) continue
    if (v.result.view.owes === 'respond') await submitRespond(gid, pid, groupId, 2)
    else if (v.result.view.owes === 'signal') await submitSignal(gid, pid, groupId, 'up')
  }
}

// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  await bringUp()

  // ── CLASSROOM: the attendance-code path, empty instance to gradebook ─────────
  banner('CLASSROOM — empty instance → roster → KC → attendance → match → START → play → push')
  {
    const gid = 'e2e-classroom'
    const PIDS = ['stu1', 'stu2', 'stu3', 'stu4']

    // 1. Sync roster (instructor). Proves the callback secret + roster URL wiring.
    const sr = await syncRoster(gid)
    check(sr.ok, `1. syncRoster — ${sr.ok ? `synced ${sr.result.synced}` : sr.error}`)
    check(rosterRequests > 0, '1. the game actually called the classroom roster endpoint')

    // 2. Attendance code (instructor).
    const gc = await genCode(gid)
    const code = gc.ok ? gc.result.code : null
    check(!!code, `2. generateAttendanceCode — ${code ?? gc.error}`)

    // 3. Each student: launch → KC → prep → ready → attendance code.
    let preGameOk = true
    for (const pid of PIDS) {
      const ar = await assignRole(gid, pid)
      if (!ar.ok) { preGameOk = false; console.log(`     assignRole(${pid}): ${ar.error}`) }
      const r = await studentPreGame(gid, pid, code)
      for (const [step, res] of Object.entries(r)) {
        if (!res.ok) { preGameOk = false; console.log(`     ${pid}/${step}: ${res.error}`) }
      }
      if (!(await beOnThePage(gid, pid))) { preGameOk = false; console.log(`     ${pid}/presence: failed`) }
    }
    check(preGameOk, '3. all four students completed launch → KC → prep → ready → attendance, and are ON THE PAGE')

    // 4. Match Now (instructor).
    const m = await matchNow(gid)
    check(m.ok, `4. triggerMatching — ${m.ok ? 'ok' : m.error}`)
    const d0 = await dashboard(gid)
    check(d0.ok && d0.result.groups.length === 2, `4. two groups formed (${d0.ok ? d0.result.groups.length : '?'})`)
    const g0 = d0.ok ? d0.result.groups : []
    check(g0.length === 2 && g0.every((g) => !g.started),
      '4. and NOTHING has started yet — matching does not start a game')

    // 5. ⚠ START CLASS — the step that was missing entirely in production.
    const st = await startClass(gid)
    check(st.ok, `5. startAllGroups — ${st.ok ? `started ${st.result.started}` : st.error}`)
    const d1 = await dashboard(gid)
    // ⚠ LENGTH FIRST, ALWAYS. `[].every(...)` is true, so an assertion written only as
    // `every(...)` reports success against zero groups. The first run of this harness did
    // exactly that — it announced "every group is now STARTED" while nothing existed.
    const g1 = d1.ok ? d1.result.groups : []
    check(g1.length === 2 && g1.every((g) => g.started),
      `5. every group is now STARTED — the control an instructor presses opens round 1 (${g1.length} groups)`)
    check(g1.length === 2 && g1.every((g) => g.round === 1), '5. and all are on round 1')

    // 5b. Re-pressable, and it does not reset a running group.
    const again = await startClass(gid)
    check(again.ok && again.result.started === 0, '5b. pressing Start class again starts nothing and breaks nothing')
    const g1b = (await dashboard(gid)).result?.groups ?? []
    check(g1b.length === 2 && g1b.every((g) => g.round === 1), '5b. running groups were not reset')

    // 6. Play all three rounds, as students.
    const groups = d1.result.groups
    const rosterSnap = await callFn('getRoster', asDev(gid, {}))
    const byGroup = {}
    for (const g of rosterSnap.result.groups) {
      byGroup[g.group_id] = Object.values(g.participants_by_role ?? {}).flat()
    }
    for (let r = 1; r <= 3; r++) {
      for (const g of groups) await playRound(gid, g.group_id, byGroup[g.group_id] ?? [])
    }
    const gEnd = (await dashboard(gid)).result?.groups ?? []
    check(gEnd.length === 2 && gEnd.every((g) => g.status === 'finished'),
      `6. all groups finished all 3 rounds through the student callables (${gEnd.length} groups)`)

    // 7. History reached the student payload.
    check(groups.length === 2 && (byGroup[groups[0].group_id] ?? []).length === 2,
      '6. the roster reports 2 seats per group')
    const anyPid = (byGroup[groups[0]?.group_id] ?? [])[0]
    const v = await roundView(gid, anyPid, groups[0].group_id)
    check(v.ok && v.result.view.history.length === 3, '7. the student sees 3 completed rounds in history')

    // 8. Reports (instructor).
    const rep = await callFn('getRoundReport', asDev(gid, {}))
    check(rep.ok && rep.result.rows.length === 6, `8. per-round report has 6 rows (2 groups × 3 rounds) — got ${rep.ok ? rep.result.rows.length : '?'}`)

    // 9. ⚠ SCORE & RECORD — the gradebook push must LAND classroom-side.
    pushed = []
    const sc = await scoreAndRecord(gid)
    await sleep(800)
    check(sc.ok, `9. scoreAndRecord — ${sc.ok ? `scored ${sc.result.scored}` : sc.error}`)
    check(pushed.length === 4, `9. FOUR gradebook records LANDED at the classroom (got ${pushed.length})`)
    check(pushed.every((p) => p.game_instance_id === gid && p.participant_id),
      '9. every pushed record carries the instance and a participant')
    check(pushed.every((p) => typeof p.normalized_score === 'number'),
      '9. every pushed record carries a normalized score')

    // 10. The roster report AFTER scoring. It filters on `finalized_at`, which
    // scoreAndRecord sets — so checking it before the push reports zero students and
    // looks like a broken report. Order matters, and this is the order an instructor uses.
    const base = await callFn('getReportData', asDev(gid, {}))
    check(base.ok && base.result.rows.length === 4,
      `10. the roster report lists all 4 students once scored (got ${base.ok ? base.result.rows.length : '?'})`)
  }

  // ── ONLINE: pre-grouped, no clock, groups auto-open on arrival ───────────────
  banner('ONLINE — pre-group → students arrive → auto-open (NO Start button) → play')
  {
    const gid = 'e2e-online'
    const PIDS = ['stu1', 'stu2']

    await syncRoster(gid)
    // Online is selected by the instructor turning the clock off.
    const cfg = await callFn('updateGameConfig', asDev(gid, { clock_mode: 'off' }))
    check(cfg.ok, `1. updateGameConfig clock_mode=off — ${cfg.ok ? 'ok' : cfg.error}`)

    for (const pid of PIDS) {
      await assignRole(gid, pid)
      await callFn('submitKnowledgeCheck', asStudent(gid, pid, { answer: 'player' }))
      await callFn('completePrep', asStudent(gid, pid, {}))
      await beOnThePage(gid, pid)
    }

    // 2. Instructor pre-groups the roster — the online equivalent of Match Now.
    const gp = await callFn('groupParticipantsOnline', asDev(gid, {}))
    check(gp.ok, `2. groupParticipantsOnline — ${gp.ok ? `${gp.result.groups} group(s)` : gp.error}`)
    const og = await callFn('getOnlineGroups', asDev(gid, {}))
    check(og.ok && og.result.groups.length >= 1, '2. the grouping panel can read the groups back')

    // 3. Students arrive. THE POINT: no Start button is pressed anywhere.
    for (const pid of PIDS) {
      const rl = await callFn('recordLogin', asStudent(gid, pid, {}))
      check(rl.ok, `3. recordLogin(${pid}) — ${rl.ok ? `mode ${rl.result.clock_mode ?? 'off'}` : rl.error}`)
    }
    // Reaching the game screen IS arriving: the student's GameScreen polls getRoundView.
    const og2 = await callFn('getOnlineGroups', asDev(gid, {}))
    const firstGroup = og2.result.groups[0]
    for (const pid of firstGroup.occupants.map((o) => o.participant_id)) {
      await roundView(gid, pid, firstGroup.group_id)
    }
    await sleep(600)
    const d = await dashboard(gid)
    const started = d.ok ? d.result.groups.filter((g) => g.started).length : 0
    check(started >= 1, `3. a group AUTO-OPENED on arrival with NO Start press (${started} started)`)

    // 4. The assignment-status report — the instructor's online surface.
    const orep = await callFn('getOnlineReport', asDev(gid, {}))
    check(orep.ok, `4. getOnlineReport — ${orep.ok ? 'ok' : orep.error}`)
    check(orep.ok && orep.result.students.length >= 2, '4. and it lists the students')
    // The arrived[] fix (game-server 0.22.0) — presence, not absence.
    check(orep.ok && orep.result.students.some((s) => s.arrived === true),
      '4. arrivals are RECORDED, not reported as "not recorded"')
  }

  banner(`RESULT — ${PASS} passed, ${FAIL} failed`)
  return FAIL === 0
}

main()
  .then((ok) => { tearDown(); process.exit(ok ? 0 : 1) })
  .catch((e) => { console.error(e); tearDown(); process.exit(1) })
