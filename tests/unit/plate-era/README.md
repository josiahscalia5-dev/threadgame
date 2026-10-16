# Plate-era rule tests (not run)

These suites tested the picture-plate engine (stitches, Snagling, tassels, butterfly, recovery loop, gate return,
plate segments/fractions, the opening pull lesson, the plate pacing bot). Milestone 1 of the Connected World rebuild
(`docs/CONNECTED-WORLD-PLAN.md`) removed that engine and does not yet place those features on the course, so they
cannot run against it. They are kept here, renamed `*.plate.cjs` so no runner picks them up, as the behavioural spec
for re-integrating the Snagling, butterfly and pull lesson after review.

They run green on the plate version at commit `635b772` (`node --test tests/unit/` there: 58/58).

The rules they cover that still apply on the connected course are re-tested in `tests/unit/connected.test.cjs`:
state shape, countdown, determinism, Loop independent of the player, no wall clock / Math.random, distinct
threads with derived counts, own-ID-only pickups, finish needs all three, ranks/times, finishWaitForLoop, pause.
