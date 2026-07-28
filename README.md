# template-stage

The spawn source for **repeated stage games** on mygames.live: ordered stages of private
decisions → payoff → repeat, played by a fixed group over N rounds.

It is a stripped, running game. Two seats, two stages, one hidden draw, three rounds. It
plays through in the emulator, its knowledge check grades, its reports render, and its
Tier 2 gate is green — from the first commit. **Spawn by copying this repo, then deleting
the placeholder game one piece at a time.** Nothing here is a sketch; if something does
not run, that is a bug in the template, not a step you were meant to finish.

> **Why a template and not "copy the last game".** Reference-copying produced ten working
> games, and every one of them inherited the reference's accumulated quirks while
> improvements made in one never flowed back. Fixes land **here** now, and every future
> spawn inherits them.

---

## What is in here

| Path | What it is |
|---|---|
| `functions/src/round/spec.ts` | **The game, declared.** Stages, roles, reveal, round count, injected resolver / defaults / legality. |
| `functions/src/round/resolver.ts` | The pure payoff function. No I/O, no randomness, no framework. |
| `functions/src/round/settings.ts` | Every number a payoff or draw depends on. |
| `functions/src/round/machine.ts` | Store layer: engine state in, engine state out. **No per-game state shape.** |
| `functions/src/round/decide.ts` | **The bot-strategy SLOT.** Throws until written. Canonically here, inside `functions/`. |
| `functions/src/kcQuestions.ts` | The question bank — import-free, so the frontend gate can read it. |
| `functions/src/gameDefinition.ts` | Identity, roles, scoring, config fields. |
| `functions/src/online.ts` | Online mode, entirely from shared factories. |
| `bot/robot-driver.mjs` | The browser robot **shell**. Two slots to fill; the rest never changes. |
| `frontend/src/reports/tier2Gate.test.ts` | The Tier 2 spawn gate, as a red test. |
| `template-round-loop.mjs` | The round-loop harness, including **the leak assertions**. |

### Engine wiring, and the one rule that must not be broken

```
functions/  @mygames/stage-engine  git tag v0.3.0   ← MUST be a git tag
            @mygames/game-server   git tag v0.22.0  ← MUST be a git tag
            @mygames/game-engine   git tag v0.7.0   ← MUST be a git tag
frontend/   @mygames/game-ui       file: symlink
            @mygames/game-engine   file: symlink
```

⚠ **The functions layer consumes shared packages by GIT TAG, never by `file:`.** Firebase
deploys `functions/` in isolation, and a `file:` path pointing outside that directory
cannot be packaged — the deploy fails, or worse, succeeds against a stale copy. Only the
frontend may use `file:`, because Vite bundles it at build time. This cost a mid-slice
blocker once; it must not be rediscovered.

After any tag bump, **verify the resolved version in the installed dist, not the
lockfile** — a plain `npm install` can silently keep the old lockfile commit:

```
node -p "require('./functions/node_modules/@mygames/stage-engine/package.json').version"
```

---

## The spawn checklist

`[YOU]` = Elena, in a console or a terminal. `[CC]` = Claude Code.
Steps are dependency-ordered; do not reorder them.

### Phase 1 — provision

1. **[YOU] GitHub repo** — `elenakatok/<game>`, empty.
2. **[YOU] Firebase project** — `<game>-mygames-live`.
3. **[YOU] Billing** — attach the billing account.
4. **[YOU] RTDB instance** — create it (presence lives here).
5. **[YOU] Firestore database** — create the `(default)` database.
   *Missing → `syncRoster` fails with `PERMISSION_DENIED`.*
6. **[YOU] Secret Manager API** — enable it.
7. **[YOU] Authentication** — enable anonymous + custom token sign-in.
8. **[YOU] Register the web app**, then write `frontend/.env.production` from the config.
   ⚠ Not copied from the template — created fresh per game.
9. **[YOU] IAM: `serviceAccountTokenCreator`** on the **compute** service account.
   *Enable the Compute Engine API first, or the account does not exist yet.*
   *Missing → every auth failure presents as "launch link invalid or has expired",
   whatever the real cause.*
10. **[YOU] The shared callback secret** — same value in BOTH Secret Managers.
    Use `printf '%s'`, never `echo`: **a trailing newline** is a 403 on every gradebook
    push and a roster that never syncs.
    ⚠ `.secret.local` belongs at **`functions/.secret.local`**, not the repo root. At the
    root, the emulator reaches past it to the live Secret Manager — a real leak and a
    value mismatch at the same time.

    **Before running `scripts/spawn-secret.sh`, add this game to
    `scripts/game-locations.json`. This is NOT conditional on sharing a project.**

    ```json
    "<game>": {
      "project": "<game>-mygames-live",
      "functionsDir": "games/<game>/functions",
      "gameSecretName": "<GAME>_CALLBACK_SECRET"
    }
    ```

    ⚠ **The fallback is not a generic name.** A game with no entry is provisioned under
    `CLASSROOM_CALLBACK_SECRET`, which is *pennies'* own secret name — kept as the
    default only because the games that already bind it cannot be changed cheaply. "No
    entry" therefore means "provisioned under another game's secret name".

    `project` and `functionsDir` are not optional decoration: the script only reports
    `manifest (game-locations.json)` when one of them is present, so a
    `gameSecretName`-only entry silently prints *"default derivation"* while still
    overriding the name. **If the banner says "default derivation", stop.**

    ⚠ **`gameSecretName` MUST equal `classroom.callbackSecretName` in
    `functions/src/gameDefinition.ts`** (see the traps table). The script writes one
    name; the deployed functions bind whatever the code says. When they disagree, the
    deploy reports success and every gradebook push 403s in front of a class.

    For a game sharing a project (the single-player family) the entry is doubly
    required: several games' secrets live in one project, and provisioning without a
    distinct name **rotates a sibling game's secret**.

### Phase 2 — scaffold

11. **[CC] Copy this repo** and strip the placeholder game.

    **The copy manifest — by name. "Configs" is not an acceptable instruction.**

    | File | Note |
    |---|---|
    | `firebase.json` | ⚠ Must keep the **functions predeploy hook**. |
    | `firestore.rules` | ⚠ Rename the round-state deny block to the game's prefix. |
    | `firestore.indexes.json` | Watch for index-build delay after deploy. |
    | `database.rules.json` | ⚠ **FERPA-critical** — see below. |
    | `.gitignore` | Includes `functions/.secret.local`. |
    | `functions/tsconfig.json` | |
    | `functions/package.json` | Re-pin to the latest tags, then verify resolved versions. |
    | `frontend/tsconfig*.json`, `frontend/index.html` | |
    | `frontend/vite.config.ts` | ⚠ **With the `resolve.dedupe` block** — without it Vite bundles a second copy of React/firebase through the `file:`-linked game-ui and the page renders blank. |
    | `frontend/vitest.config.ts` | Separate from vite.config on purpose — see the file. |
    | `frontend/public/` — **all of it** | ⚠ Brand assets: `logo-header.svg` (orange `#D38626`), favicon, everything. A missed copy ships a black header. |
    | `bot/robot-driver.mjs` | |
    | `template-round-loop.mjs` | Rename; keep section (L). |

    **Created fresh, never copied:** `.firebaserc`, `frontend/.env.production`,
    `functions/.secret.local`, KC content, role PDFs, scoring config.

    ⚠ **`database.rules.json` must carry the instance-claim pattern** on
    `presence/$instanceId` **and** `attending/$instanceId`:
    `".read": "auth != null && auth.token.game_instance_id == $instanceId"` — operator
    `==`, because RTDB rules have no `===`. `attending` write `false`; root read/write
    `false`. **Never `.read: true`** on those paths: names and roles would be world
    readable. Verified correct across all ten games on 2026-07-24; keep it that way.

12. **[CC] Rename and rewrite.** `REPLACE_FROM_TEMPLATE` marks every site.
    Set `game_id`, the collection prefix, `corsOrigins`, `callbackSecretId`,
    `callbackSecretName`, the roles, the stages, the payoff, the settings, the questions.

    ⚠ **`firestore.rules` carries the collection prefix too, and it is not a
    `.ts`/`.tsx`/`.json` file** — a rename pass scoped to source globs misses it, and the
    round-state deny block silently keeps naming a collection that no longer exists.
    Rename it explicitly, together with `ROUND_COLLECTION` in the round callables.

    *(This was missed on the first real spawn. The leak assertion in section (L) of the
    harness caught it, because it greps the rules text for the collection name rather
    than assuming the collection is unreachable. Keep that assertion.)*

    ### The two markers

    | Marker | Means | Treatment |
    |---|---|---|
    | `REPLACE_FROM_TEMPLATE` | unspawned **identity** — `game_id`, domain, secret name, prefix | **A blocker.** The harness asserts it to zero the moment the game is spawned. |
    | `PLACEHOLDER_GAME` | the template's stand-in **game** — payoffs, stages, screens, bot | **Scheduled work.** Counted and reported, never asserted. |

    Keep them separate, and **never silence the second by deleting markers off unwritten
    code** — a gate that goes green over a game nobody has written yet is worse than no
    gate, because it is believed.

13. **[CC] Build both layers clean**, run `template-round-loop.mjs`, run the frontend
    test suite. All three must be green before anything is deployed.

### Phase 3 — register with the classroom

14. **[CC] Registry** — edit **only** `classroom/game-registry.json`. The two
    `gameRegistry.ts` files are **generated** by `scripts/gen-registry.mjs` via prebuild
    hooks; hand-editing them is overwritten on the next build.

15. **[CC]+[YOU] Bind the callback secret in classroom source — MANUAL. Codegen does NOT
    do this, and no amount of redeploying helps.**

    `spawn-secret.sh` creates the secret **value** in all three places. It does **not**
    declare the **binding**. Without it the game's finalize/`scoreAndRecord` push and
    `syncRoster` fail secret verification with a 403.

    **Four edits in `classroom/functions/src/index.ts`:**
    1. `defineSecret("CALLBACK_SECRET_<GAME>")`
    2. a resolver-map entry matching the game's `classroom.callbackSecretId` (e.g. `<game>_v1`)
    3. bind the secret to `receiveGameResult`
    4. bind the secret to `getCourseRoster`

    Match exactly how the most recent game is declared and bound. **Do this BEFORE the
    step-16 deploy** — that deploy is what binds the edits.

    **Verify with `gcloud run services describe`, not with the deploy output** — the
    deploy reports success either way. Check **both** functions:

    ```
    gcloud run services describe receivegameresult --region us-central1 --project mygames-classroom-aec1b --format="value(spec.template.spec.containers[0].env)"
    gcloud run services describe getcourseroster --region us-central1 --project mygames-classroom-aec1b --format="value(spec.template.spec.containers[0].env)"
    ```

    `describe` shows what is **bound to the function**, not what exists in Secret
    Manager. Absence from `describe` does **not** mean the secret is missing — check that
    separately with
    `gcloud secrets versions list CALLBACK_SECRET_<GAME> --project mygames-classroom-aec1b`.

    > ⚠ **Do NOT run `firebase functions:secrets:set` to "fix" a missing binding.** It
    > prompts for a new value and creates a second version that will **not match the game
    > side**. The value already exists; the missing piece is the source binding above.

    **Known-correct asymmetry:** `CALLBACK_SECRET_POLL` is bound to `getCourseRoster`
    only, not `receiveGameResult` — deliberate, because Poll does not push grades. Do not
    "fix" it.

16. **[YOU] Redeploy classroom — four functions plus hosting.** Registering a game is not
    one deploy. **Dry-run first, always, for classroom:**

    ```
    env -C <abs>/classroom firebase deploy --project mygames-classroom-aec1b --only functions:generateGameToken,functions:generateStudentToken,functions:receiveGameResult,functions:getCourseRoster --dry-run
    env -C <abs>/classroom firebase deploy --project mygames-classroom-aec1b --only functions:generateGameToken,functions:generateStudentToken,functions:receiveGameResult,functions:getCourseRoster
    env -C <abs>/classroom/frontend npm run build
    env -C <abs>/classroom firebase deploy --project mygames-classroom-aec1b --only hosting
    ```

    *Missing the token functions → student launch 404s even though codegen ran.*

### Phase 4 — deploy the game

17. **[YOU] DNS** — Porkbun CNAME: host `<game>` → value `<project>.web.app`.

18. **[YOU/CC] Deploy.**

    ```
    grep -rn "REPLACE_FROM_" <abs>/games/<game>/functions/src <abs>/games/<game>/frontend/src   # must be EMPTY
    env -C <abs>/games/<game>/frontend npm run build
    env -C <abs>/games/<game> firebase deploy --project <project> --only hosting
    # → THEN connect the custom domain in the console (the button appears only AFTER the first hosting deploy)
    env -C <abs>/games/<game> firebase deploy --project <project> --only functions:<name>,functions:<name>,…
    ```

    ⚠ **Deploy by name. Never blanket `--only functions`.** A blanket deploy mints a Cloud
    Run revision per function and eventually trips *"Quota exceeded for total allowable
    CPU"*, which blocks every deploy in the project. When that happens, run
    `classroom/tools/sweep-revisions.sh` (dry-run by default; `--delete` for real).

    ⚠ **Always pin the working directory with `env -C`.** `--project` sets the target, not
    the source: the wrong cwd analyses the wrong functions against the right project.

    ⚠ **Hosting needs `npm run build` first.** Only `functions` has a predeploy hook (in
    `firebase.json`); hosting does not, and Firebase deploys a stale `dist/` while
    reporting success.

19. **[YOU] IAM invoker bindings** — `roles/run.invoker` for `allUsers` on **every new
    callable**. **Gen-2 service names are lowercase** (`getroundview`, not
    `getRoundView`). IAM persists across redeploys, so this is once per function — but do
    it immediately, because a missing binding presents as a generic auth error.
    **Leave `seedGroupForTest` / `seedRosterForTest` unbound.** They are emulator-locked
    in code; do not bind them "just to test something".

20. **[YOU/CC] Deploy all rules.**
    ```
    env -C <abs>/games/<game> firebase deploy --project <project> --only firestore:rules,firestore:indexes,database
    ```
    *Missing Firestore rules → students see "Missing or insufficient permissions".*
    *Missing RTDB rules → presence `permission_denied`, and the Match button never enables.*

21. **[CC] Register in the LOCAL TEST LAUNCHER — a SEPARATE registry.**

    Registering in the classroom app does **not** register the game in
    `classroom/tools/launcher/`. The game appears in the classroom list and stays
    invisible to the launcher; without it, prod smokes and robot drives cannot target it.

    Check: `grep -rn "<game>" classroom/tools/launcher/` — nothing returned means it was
    never added.

    Fix: add the game to **`GAME_PROJECTS` in `classroom/tools/launcher/server.mjs`**
    (`<game>: '<project>'`, matching how the existing games are wired), then **restart the
    launcher** — `GAME_PROJECTS` is read at startup. A standard one-project-per-game game
    needs only this; `scripts/game-locations.json` is for shared-project deviations only.

    Still not appearing after a restart? A stale process is holding the port:
    `lsof -i :3000 -i :3001 | head`.

### Phase 5 — verify

22. **[YOU] Click through production.** Emulator-green is necessary and not sufficient;
    a CC report of "all green" is not done either. In production:
    - Dashboard loads; roster syncs with **real names**, not ids.
    - A student launches from the classroom, gets the right role, reaches the game.
    - **The logo renders orange** on the student screens *and* the dashboard.
    - Match → play → finalize → **gradebook push lands** (real z-scores; absents handled).
    - KC: the gate is ungraded, graded questions are role-filtered, and explanations
      name concepts with **no letter or position references**.
    - After finalize the instance is **dead**. Re-testing needs a new instance.

---

## Traps this template already handles (do not undo them)

| Trap | What it looks like |
|---|---|
| **Missing per-question KC grader** | KC renders perfectly, then submit throws "not a valid graded KC question". All four KC functions are wired in `index.ts`. |
| **Free-text `open_response`** | Renders fine, reports nothing. The bank uses `format: 'text'`; the gate test asserts it. |
| **Free-text question with no Tier 2 report** | Silently missing report. `tier2Gate.test.ts` fails the build. |
| **Numeric map keys through Firestore** | `roleBySeat[0]` is undefined after a round trip and nothing type-errors. `reviveState` fixes it on every read. |
| **Round state readable by clients** | The reveal rule works and the game is still broken. `firestore.rules` denies the collection by name; the harness asserts the rule. |
| **A leak that is null instead of absent** | `?? 'unknown'` turns it back into a value. The harness asserts key absence, never emptiness. |
| **Defaults charted as behaviour** | A biased Tier 3 line that just looks slightly wrong. `buildRoundSeries` excludes them by default. |
| **A mirrored bot strategy** | Two copies and a drift test. There is one `decide()`, inside `functions/`. |
| **Adding a config field** | "No recognised fields to update" on correct code — redeploy **both** `getGameConfig` and `updateGameConfig`. |
| **Secret name mismatch** | Deploy reports success; every gradebook push 403s. `gameSecretName` in `game-locations.json` must equal `classroom.callbackSecretName` in `gameDefinition.ts`. One field feeds `finalizeInstance`, `pushResultsToClassroom` **and** `syncRoster`, so they cannot disagree with each other — only with the manifest. |
| **`.rules` missed by a rename** | The round-state deny block names a dead collection. The harness's leak assertion catches it; do not weaken that assertion to "the collection is unreachable". |
| **Stale deployed artefact** | "The code is right but the behaviour is old." Suspect the deployed thing — `lib/`, the bundle, `dist/` — before the source. |

## Running it

```
cd functions  && npm install && npm run build
cd ../frontend && npm install && npm run build && npm test
cd ..          && node template-round-loop.mjs      # KEEP=1 leaves the emulators up
```
