# Complete Level 1 — implementation specification

This is the authoritative gameplay specification for the approved **seven-screen visual kit**. It supersedes the earlier spring-first and hold-to-weave bridge concepts. The supplied images and walkthrough explain the complete level visually; the continuous playable level and the following behaviors remain for Claudia to implement.

## Purpose and cast

Purl races through a magical loom city to collect three wish threads and open the flower gate. Loop races independently toward the same finish. The friendly contest gives the player simple, varied ways to change the embroidered world, with one recoverable surprise encounter.

| Character | Role | Fixed appearance |
|---|---|---|
| Purl | Player | Coral-red crocheted body, one curled yarn tuft, small limbs and brown woven soles. |
| Loop | Computer rival | Teal crocheted body, two curled loop tufts and brown woven soles. |
| Snagling | Mischievous enemy | Small plum yarn tangle, stitched eyes, loose yarn limbs. |
| Embroidered butterfly | Tapestry interaction | Coral and gold stitched butterfly that wakes from the hanging teal tapestry and delivers the golden spool. |

Purl and Loop compete. They do not rescue one another, share a tether, weave together or use a team-save ability. Identify Loop as a computer rival in help/start information. His behavior may feel natural and fallible, but must not be presented as a real online person.

## The complete route and seven pictured moments

The seven approved images are keyframes, not seven independent game rooms. Four and five illustrate alternate moments on the same broad landing. A successful dodge skips those hit/recovery states. Build connected travel before, between and after the keyframes.

| Beat | Approved image or connector | Purl's action and environment | Held count after the beat |
|---|---|---|---|
| Ready | Approach to `01-ribbon.png` | Start on the lower coral carpet with Purl facing into the city. A short ready cue introduces the glowing stitch and the first tap. Loop starts on the neighboring teal route. | 0/3 |
| Unfurl the ribbon | `01-ribbon.png` | Tap the reachable golden stitch. The curled coral ribbon unrolls upward around the wooden tower and settles into a continuous ramp. Run to the visible coral spool. | 1/3 only when the spool is touched |
| Ribbon-to-shortcut connector | Between 01 and 02 | Follow the top ribbon around the tower onto a broad teal/coral landing. Keep the gold braid and tower landmarks continuous; the camera follows the turn. | 1/3 |
| Open the shortcut | `02-shortcut.png` | Tap the stitch at the safe lower end. The rolled embroidered carpet unfurls across the missing route section and joins the far landing. | Still 1/3 |
| Shortcut-to-tassels connector | Between 02 and 03 | Cross only after both ends are connected. Round the next tower onto the raised floral approach with three low tassels ahead. | Still 1/3 |
| Lift the tassels | `03-tassels.png` | Tap the local stitch. Three tassels lift in a short readable sequence. When the route clears, move to the teal spool on the raised round landing. | 2/3 on pickup |
| Tassels-to-enemy connector | Between 03 and 04 | Continue off the collection ledge and around the post onto broad safe carpet. Restore ordinary movement controls before the enemy can reveal. | 2/3 |
| Snagling: dodge branch | Same landing as 04/05 | Snagling hops out from behind the left post. A successful dodge/jump avoids contact. Continue directly toward the tapestry area. | Remains 2/3; no drop or recovery popup |
| Snagling: hit branch | `04-snagged.png` | A missed dodge briefly tangles Purl's ankles. One held thread, illustrated as teal, lands on safe carpet to the right. | 2/3 → 1/3 |
| Recover | `05-recovery.png` | Move into the dropped teal thread. It returns to Purl's inventory; the same item's identity is restored. | 1/3 → 2/3 |
| Enemy-to-tapestry connector | After dodge or recovery | Continue around the landing's curve to the next coral approach, with the tall teal tapestry on the left and Loop's route to the right. | Normally 2/3 |
| Wake the embroidery | `06-butterfly.png` | Tap the stitch on the tapestry's lower-left fitting. The embroidered butterfly lifts away, carries the golden spool and places it on the connected collection terrace ahead. Purl collects it. | 3/3 on actual pickup |
| Final connector | Between 06 and 07 | Run a short, clearly connected carpet stretch toward the luminous flower arch. Keep all held threads and show the gate opening response. | 3/3 |
| Finish | `07-finish.png` | Reach the finish trigger with all three held identities. Show the actual race order, then replay. | 3/3, level complete |

The teal spool glimpsed in the shortcut picture is a sightline preview of the **same second collectible** reached through the tassel section. It is not an additional pickup. Position route boundaries so Purl cannot bypass the tassel task simply because the spool is visible from the shortcut. Do not award a thread for tapping the shortcut stitch.

The butterfly scene shows Purl at 2/3 because delivery/pickup has not completed yet. Change to 3/3 only after the golden spool enters the player's possession. The finish illustration shows one possible result, Purl first and Loop second; do not force that result.

## Proposed pacing and transition plan

These are initial tuning targets, not behavior already implemented in the visual kit. A successful first attempt should generally take about 90–150 seconds. The following example uses a roughly two-minute route with a recoverable hit. A successful dodge shortens it; slower discovery or recovery can lengthen it.

| Approximate elapsed time | Beat | What must happen between the pictured frames |
|---|---|---|
| 0–5 s | Ready and first instruction | Establish rear camera, show Loop's computer-rival role once, reveal one contextual tap hint. |
| 5–25 s | First ribbon and coral pickup | Tap, animate unfurling, settle ramp, resume movement, travel upward, collect coral. |
| 25–35 s | Connector | Travel around the tower to the shortcut entry; do not jump-cut to another unrelated platform. |
| 35–50 s | Shortcut | Tap, animate carpet rolling forward, join both ends, cross to the next approach. No score change. |
| 50–68 s | Three tassels and teal pickup | Reach the stitch, lift three tassels, pass under clear ropes, collect teal. |
| 68–78 s | Broad landing and Snagling | Restore running controls, reveal enemy, allow dodge or apply one hit. |
| 78–87 s | Optional recovery | Settle the dropped spool, recover it safely, resume the route. Skip this interval after a successful dodge. |
| 87–108 s | Tapestry and gold pickup | Reach tapestry, tap stitch, wake butterfly, deliver golden spool, collect it. |
| 108–120 s | Final sprint and result | Connect to flower terrace, validate all three identities, open gate, record finish order. |

Use short distinct tap reactions: approximately 0.8–1.5 seconds for unfurling a segment, three short staggered lifts for the tassels, and approximately 2–3 seconds for the butterfly's delivery. These are suggested starting values. Do not let decorative animations force long waits or make the race outcome predetermined.

## The stitch interactions

One simple gesture drives four visibly different changes. Use a small world-anchored “Tap the stitch” cue initially; reduce repeated instruction once understood. Each stitch is a deliberate touch target, not an accidental swipe target.

| Interaction | Visible transformation | Completion rule |
|---|---|---|
| Ribbon | Curled coral ramp unfurls and rests against its support. | Route becomes traversable after it is physically continuous and settled. |
| Shortcut | Rolled floral carpet extends from the current platform to the far landing. | Both ends connect; traversal is enabled; no inventory increment. |
| Tassels | Three plum tassels lift on gold ropes in sequence. | All blocking tassels clear Purl's full height before traversal resumes. |
| Butterfly | Flat embroidered butterfly wakes from the tapestry and carries the golden spool to the terrace. | Delivery places an existing unique gold item on reachable carpet; pickup remains separate. |

Slow or stop Purl on broad safe ground while a required tap owns attention. Do not auto-run him into a gap while he reads the cue. Do not allow Snagling to attack while interaction input is locked or during a required delivery animation. Loop continues on an independent route with comparable task time, rather than being given a free route because Purl is interacting.

Once a ribbon or shortcut opens, it stays open for the attempt. Lifted tassels stay safely clear until all relevant runners have passed. Do not roll up a route underneath either racer. A missed tap remains retryable; a button press is not a scarce resource. Do not require precise repeated rhythm taps for Level 1.

## Collectible identity and progress

Each racer has three separate unique object IDs. Recommended IDs are `purl.coral`, `purl.teal`, `purl.gold` and the corresponding `loop.*` IDs. Each item tracks `uncollected`, `held` or `dropped`, with a location when present in the world. The displayed 0/3–3/3 count is the number currently held, not the number of pickup animations ever played.

- A normal pickup changes one ID to held and increments the held count once.
- A drop changes one held ID to dropped and decrements the held count once.
- Recovery restores that same ID to held. The approved “+1 THREAD” is inventory restoration, not a new unique item, reward credit or fourth collectible.
- Repeated collision with an already held item's visual must do nothing.
- Loop's objects cannot be collected by Purl, and Loop cannot remove Purl's required objects.
- A race finish is eligible only with all three of that racer's IDs held. Touching the gate early does not win.

Preserve missing-item access. A required collectible is never thrown into the void, expired by a timer or left permanently behind by an auto-running camera. Use a short recovery loop that rejoins the local landing, or keep forward motion paused until the recovery choice is resolved. Reaching the gate while incomplete must lead back to a reachable recovery connection; it must not create an unwinnable dead end.

## Snagling: surprise, contact and recovery

The small Snagling visible earlier in the approved shortcut image is a harmless, non-colliding cameo. It must not attack or interrupt that interaction. For the later attack encounter, hide Snagling behind the left post or folded fabric until Purl is on the wide landing. Do not add an advance warning arrow or countdown. The reveal itself is the surprise. Once visible, a short readable hop provides a real opportunity to dodge or jump. Start tuning with about **0.55 seconds from visible reveal to possible contact** and adjust through touch-device testing. No unavoidable off-screen attack is allowed.

On contact, loose plum yarn briefly tangles around Purl's feet; he wobbles for roughly **0.5 seconds**, breaks free and stays on safe carpet. Snagling does not abduct him or drag him over an edge. Apply one damage event per attack, followed by roughly **1.6 seconds of damage immunity**. Keep any immunity glow subtle enough to read the route.

| Inventory when hit | Result |
|---|---|
| Two or three held threads | Drop exactly one held ID, preferably the most recently collected. |
| One held thread | Drop that ID and continue at 0/3. Losing the last thread does not itself end the attempt. |
| Already at zero when a new valid hit occurs | Start the fail sequence. |
| During immunity | Ignore additional contact; no extra drop or failure. |

Protect the first learning interaction from surprise damage. Separate the Snagling area from blocking tassels and gaps. The attack is disabled during the stitch interactions and other input locks. Make the visible contact, hit animation and damage timing agree.

For the approved hit branch, Purl enters with coral + teal. Drop `purl.teal` slightly forward/right onto the same broad landing, outside Snagling's contact zone. Show “SNAGGED!” and 1/3. After the player recovers it, show “THREAD RECOVERED,” restore 2/3 and continue. The approved images 04 and 05 illustrate those states on the same ground. A successful dodge keeps 2/3 and does not show either message.

Neither a hit nor a fail reduces already saved rewards. Recovery cannot be used to farm monetary credit.

## Loop's independent race

Loop should feel like an active opponent who occupies the world, not a decorative sprite. Give him his own connected route, three equivalent pickup tasks, reactions and finish time. He may choose a different path, pause briefly to read a task, take a slightly imperfect jump or recover from an obstacle. Keep those actions tied to simulation state and visible events.

Loop reacts after obstacles become visible to him. He does not teleport, phase through collision, obtain invisible pickups or change his score simply because Purl's score changed. Preserve his route position when a tower temporarily hides him. Display his actual current held count, not the sample numbers baked into reference art.

Balance his bypass with comparable travel/interaction cost. Do not grant instant task completion while Purl must wait through animations. Do not slow him artificially to guarantee Purl first. Loop can genuinely win; Purl can finish the level in second place after gathering all three threads. If Loop loses a thread, apply an equivalent reachable recovery rule on his own route.

## Controls and camera for the finished game

Use auto-run for forward travel, swipe left/right for safe route movement or branch choice, and swipe up for a dodge jump where designed. A slide gesture is optional only if a distinct slide obstacle and animation are actually implemented. The revised core interactions are **tap the stitch**; do not reintroduce the old hold-to-weave control.

Keep button taps separate from running gestures. Use generous touch targets, short input buffering near landing and no accidental double activation. Pause all race and hazard timers consistently. Backgrounding the app must not leave Loop racing while Purl cannot act.

The camera stays behind and slightly above Purl. Both racers face away into the world. Purl is lower-center, fully visible, with enough route ahead to read the next interaction. Match the approved per-scene framing and depth scale. Turn smoothly around towers and preserve landmarks between scenes.

## Finish, retry and saved rewards

At the finish trigger, require all three IDs held, record the actual rank and stop damage to a completed runner. Open the flower gate with the approved petal, glow and embroidery treatment. Show Level 1 Complete and Replay. The approved image is a sample after both racers have reached 3/3; do not display a premature Loop completion if he is still finishing.

A valid zero-thread hit produces a gentle fail/retry state. Retrying resets the current attempt's route and collectible state. Keep prior saved rewards unchanged. No purchase, ad or payment is required by this design to retry.

The saved-rewards footer is **visual only in this kit**. Cash out is locked. There is no implemented real-money balance, exchange rate, crediting service or payout backend. Do not create dollar earnings from decorative spool animations. A real payout system requires a separate authenticated implementation, outside this visual handoff.

## Acceptance checks for Claudia's completed game

1. The exact seven approved references remain intact, and their moments are recognizable in the actual same-theme connected level.
2. Ribbon and shortcut connect physically at both ends; Purl cannot walk across a gap or be dropped by a retracting path.
3. Opening the shortcut keeps Purl at 1/3; the tassel-route teal pickup changes 1/3 to 2/3.
4. The three tassels clear before Purl moves beneath them. Snagling does not attack during stitch locks.
5. The butterfly wakes from the tapestry and delivers the gold item to reachable ground; 3/3 occurs on pickup, not on tap.
6. A successful Snagling dodge bypasses the hit/recovery branch and retains 2/3.
7. A hit at 2/3 drops one unique item, recovery restores only that ID, immunity blocks repeated damage, and the specified one-to-zero versus already-zero distinction holds.
8. Missing or dropping any required item leaves a reachable recovery path. No recovery grants an extra unique item or saved reward.
9. Loop can genuinely finish first or second through his own tasks; Purl may complete in second place with 3/3.
10. Pause/resume and app backgrounding preserve movement, interaction, attack and collection state without an unfair opponent advantage.
11. Real Android touch/inset checks preserve full characters, critical routes, controls and readable UI across tested viewport sizes. Report tested devices; do not claim all Android phones were tested.
