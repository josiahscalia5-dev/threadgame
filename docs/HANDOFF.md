# Wishweave Wonders: handoff (where everything is, and what's next)

Updated 2026-10-16, ~19:55 UTC. Repository `josiahscalia5-dev/threadgame`, working branch **`ccr-41c3f304-c2djh7`**
(continues `ccr-207f431c-z9upqo`). Read this first when you continue in a new session.

## Latest decision (user, ~19:50 UTC): the ORIGINAL game is restored

* The user reviewed the Connected World 3D rebuild and asked for their original game back. `game/`, `tests/`,
  `android/` and `dist/` now match checkpoint **`635b772`** exactly (verified: empty diff; its 58/58 unit tests pass;
  screenshot `docs/checkpoints/connected/01-original-restored.jpg` next to approved screen 01).
* What the user objected to: the 3D version did not look like their approved screens — it used invented models,
  textures, towers and a background with buildings they never had. Do NOT replace their art or background with
  invented scenery. Any future change must keep their approved look and be shown side by side with their screens
  before going further (the user wants every screen change shown and validated).
* The 3D connected-road work (route graph, ported kit input/route code with 34 kit tests, connected race sim,
  three.js renderer, art-derived carpet tool) is preserved at commit **`b36b7aa`** if it is ever wanted again.
  The blurred-pillar transition between scenes is therefore back as it was in the original.

## Saved history

| What | Where |
|---|---|
| All chats with Claude, from every session and including messages sent while Claude was busy | `history/CHAT.md` (readable) |
| Every build agent's task and last report | `history/AGENTS.md` |
| Full raw transcripts (main chats, agents, workflow agents) | `history/transcripts/` |
| Auto-save | `tools/autosave.sh` commits and pushes about every 3 s while a Claude session's machine is running. History is refreshed about every 15 s by `tools/export-history.py`. |

## Project state

1. **Plate-based Level 1 (previous approach): complete and recoverable.**
   * Checkpoint commit **`635b772`** on this branch. The tag `checkpoint/plates-level1-2026-10-16` exists locally only, because GitHub refused the tag push from this session (HTTP 403).
   * Contents:
     * the full level on painted "plates";
     * the opening TOUCH → PULL → OPEN lesson (`docs/PULL-STITCH.md`);
     * renderer milestone 2 (all scenes);
     * 58/58 unit tests;
     * touch e2e scripts;
     * a debug APK in `dist/`.
   * Proof files: `docs/checkpoints/2026-10-16-pull-stitch-compare.jpg` and `2026-10-16-pull-stitch-touch-run.mp4`.
2. **New direction (user, 18:37 UTC): Connected World.** One continuous 3D course instead of picture-to-picture wipes.
   * The kit is extracted and checksum-verified at `kit/connected/Wishweave-Connected-World-Kit/`. Start with its `CLAUDIA-PROMPT.txt`, `START-HERE.txt` and `docs/ACCEPTANCE.txt`.
   * The user's prompt as uploaded: `kit/connected/CLAUDIA-PROMPT-as-uploaded.txt`.
   * The user asked to **inspect first, explain the renderer scope and reuse plan, build only the connected opening through the next area, then stop for review**.

## Done so far for Connected World

* The kit is in the repo; all 81 SHA-256 sums verify.
* Course facts from `scenery/route.json`:
  * main road 201.3 m long and 6 m wide;
  * tassel bypass branch at main s 81.4–97.4 (19.5 m long, 2.6 m wide);
  * sections spoolwake, bellspindle, tassel, snagling, butterfly, flowergate;
  * threads: red at s 30.2, teal at s 104.7, gold at s 161.1;
  * finish at s 201.3, at the flower gate.
* `game/vendor/three.min.js`: three.js r147 UMD build (MIT, `game/vendor/README.txt`, sha256 recorded). It is the planned WebGL renderer: a classic script with the global `THREE`, so it also loads in Node tests and offline in the Android WebView.
* **Inspection in progress:** a four-agent read-only workflow (engine, kit code, course geometry, art) was started at ~18:45 UTC. Its transcripts are saved under `history/transcripts/131a49c9-…/subagents/workflows/`. If it did not finish, rerun the inspection; the script is in that session's workflows folder, and its four prompts are in the transcript.

## Planned next steps (not started)

1. Write `docs/CONNECTED-WORLD-PLAN.md`:
   * the evidenced root cause of the wipe: connector segments in `game/src/data/level.js` / `game/src/sim/race.js` have no floor, and `game/src/render/renderer.js` `drawTransitionScene` sweeps a blurred plate column;
   * a keep/replace table;
   * the renderer scope.
2. **Milestone 1:** a WebGL world built from `route.json` and GLB nodes, with crochet materials, rails, towers and a backdrop.
   * 3D crochet Purl and Loop rigs with a distance-driven gait.
   * A continuous-route sim: steer, branch selection, jump, double-tap brake, pause, Loop AI.
   * The kit's touch input ported to a classic script, plus Left/Right/Jump/Run-Stop buttons.
   * A chase camera; the HUD, overlays and Android host reused.
3. Proof: uncut normal and debug-geometry recordings from one commit, at 720×1602 and a narrower viewport, plus an APK. Then stop for the user's review.

## How to run things

* Game in a browser: `python3 -m http.server 8100 --bind 127.0.0.1` from the repo root, then open `http://127.0.0.1:8100/game/index.html` (`?test=1` adds the test API).
* Tests:
  * `node --test tests/unit/`
  * `node tests/e2e/pull.cjs OUT --record`
  * `node tests/e2e/play.cjs --branch dodge|hit`
* APK: `tools/build-android.sh` (needs the Android SDK in `/opt/android-sdk`; the install command is in `history/CHAT.md`). Output: `dist/wishweave-wonders-level1-debug.apk`.
* Restart auto-save in a new session: `setsid nohup tools/autosave.sh > /tmp/autosave.log 2>&1 &`. Update the `Claude-Session` line in the script first.
