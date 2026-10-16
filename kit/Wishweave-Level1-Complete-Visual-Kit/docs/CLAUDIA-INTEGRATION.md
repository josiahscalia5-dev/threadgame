# Claudia integration guide

The user has approved the seven revised screens and asked for the complete level's visual foundation so Claudia can implement the playable features. This package is that handoff. It is not permission to redesign the setting or to substitute the earlier five-screen spring/bridge route.

## Included versus still to implement

| Area | Included in this visual kit | Claudia's remaining work |
|---|---|---|
| Approved appearance | Seven full-resolution immutable PNG references | Match them in the actual rendered level and retain them for comparisons. |
| Scenic backgrounds | Six unique derived clean plates covering seven keyframes | Build continuous travel, connecting surfaces, depth/occlusion and any missing intermediate views. |
| Characters and enemy | Reusable front/rear character and Snagling art/atlases | Complete animation, stable pivots, movement, collision and state-driven poses. |
| Feature art | Props, UI, interaction art and revised ribbon/shortcut/tassel/butterfly elements | Animate unfurling, lifting, emergence/delivery, collection and hit/recovery. |
| Scene presentation | Responsive visual-review/authoring sources and sample compositions | Implement a connected playable route; keyframe navigation is not gameplay. |
| Level rules | Full route, timing targets, branch and inventory specification | Implement, tune and test those rules. |
| Rival | Appearance and fairness specification | Independent Loop route, task simulation, mistakes and actual finish order. |
| Android | Source host for the visual viewer, with native safe-inset handling and build instructions | Compile the host, finish gameplay integration, profile and test real devices/input. No APK is supplied. |
| Rewards | Compact illustrative footer and locked cash-out appearance | A separately authorized authenticated ledger/payout service, if requested. No backend or real crediting is supplied. |
| 3D | 2D references and reusable art | If choosing 3D, author matching models, materials, rigs and scene geometry. No GLB/FBX or rigged models are supplied. |

The phrase “complete visual kit” means the entire level's story and seven key moments are covered. It does not mean every animation frame or meter of a continuous game world has already been built. The approved images stay exact; independent clean plates and movable sprites are derived authoring pieces that may differ in small details.

## Read and open in this order

1. `START-HERE.txt` and `CLAUDIA-PROMPT.txt`.
2. All seven PNGs in `approved/`, especially the corrected connected shortcut and the same-landing hit/recovery pair.
3. The supplied visual walkthrough, using both reference and layered views where provided.
4. `docs/ART-DIRECTION.md` and `docs/LEVEL1-GAMEPLAY-SPEC.md`.
5. `assets/manifest.json`, any additional manifest files, and the current scene source before importing or changing it.
6. `docs/scene-connections.json` for a machine-readable route/state handoff. Its values are design metadata, not implemented collision or timing code.
7. `docs/ANDROID-BUILD.md` if compiling the supplied Android visual-viewer host.

Preserve this delivery as a baseline and implement the game in a working copy. Do not overwrite approved PNGs to make a changed implementation appear to match.

## Sharing files

`Preview-Wishweave-Level1-Complete-Small.html` is the self-contained compressed review copy designed for easy sharing. It contains enough imagery to understand the seven approved moments but does not replace the full-resolution art or every reusable asset.

`Wishweave-Level1-Complete-For-Claude.html` is the small external-assets entry file. Keep it alongside the extracted kit folders; it is not a standalone upload. Use `Wishweave-Level1-Complete-Visual-Kit.zip` to deliver all source and art. If the receiving chat does not accept ZIP files, extract it and upload the prompt, docs, approved PNGs, manifests and needed assets in batches with their names preserved. The separately supplied `CLAUDIA-LEVEL1-COMPLETE-PROMPT.txt` is the convenient prompt attachment.

## Individual assets for direct import

The kit includes 51 individual transparent crops in `assets/individual/` in addition to the original atlases. `assets/individual/manifest.json` records each source atlas, exact crop rectangle, size and default pivot. The eight named rear poses for each racer are `idle`, `run-left`, `run-pass-a`, `run-right`, `run-pass-b`, `jump`, `duck` and `stumble`. Front mascot, Snagling and UI crops use numbered frame names. Props use names such as `coral-thread.png`, `teal-thread.png`, `golden-thread.png`, `swinging-tassel.png`, `cover-post.png` and `flower-gate.png`.

The revised feature pieces are in `assets/features/`: `stitch-loop.png`, `carpet-rolled.png`, `carpet-flat.png`, `butterfly-closed.png`, `butterfly-open.png` and `butterfly-carrying-spool.png`, with a feature atlas and `feature-manifest.json`. Use these as reusable components; they do not themselves supply a complete unfurling mesh or every butterfly animation frame.

Character crop pivots default to bottom-center. Hanging tassels should rotate/lift from a top attachment pivot instead. Read `docs/individual-asset-checks.json` for source-crop details, including tiny inherited edge slivers in two Snagling crops; original source pixels were deliberately preserved. Inspect these at intended render size before production cleanup.

## Route construction

Build the route as connected segments rather than using a scene index as the player's world position. The opening carpet connects to the unfurled ribbon; its top connects around the loom tower to the shortcut; the shortcut joins the tassel approach; that approach joins the broad Snagling landing; that landing joins the tapestry terrace; the terrace joins the flower gate.

Use 2.5D path curves, perspective scaling and explicit walkable/collision regions if that preserves the approved view well. Add foreground masks or layered objects for posts and hanging fabric. If choosing 3D, build the required geometry and rigs; a PNG is not a depth mesh. Whichever method is used, verify near/far paths attach rather than relying on a flattened picture to imply an impossible connection.

Keep three coordinate systems explicit: route/world state, reference-art composition, and actual device/safe-area pixels. A sprite's screen coordinate alone is not its route progress. Use stable feet anchors and depth-consistent scale. Read the provided scene metadata before assuming an origin or coordinate convention.

## Separate state from presentation

Use independent data for:

- Attempt: current route segment, movement/interaction state, race clock, completion and failure.
- Purl inventory: `purl.coral`, `purl.teal`, `purl.gold`, each uncollected/held/dropped with a location when needed.
- Loop: independent route, inventory, interaction state, obstacle reactions and finish time.
- Environment interactions: stitch idle/activated/animating/open, route connectivity, tassel clearance and butterfly delivery phase.
- Snagling: concealed/revealing/attacking/recovering, contact consumed and cooldown.
- Presentation: camera, sprite frames, particle effects, HUD and visual-review controls.
- Saved rewards: no real account authority in this kit; never modified by hits or item recovery.

Reference scores are sample keyframe states. They are not a script requiring Purl to be hit or win. Replace them with state-derived counts in the actual game. When the player dodges Snagling, transition from the broad landing to the tapestry connector without triggering the hit and recovery UI.

## Implement the revised interactions

Use tap-to-stitch for ribbon unfurling, shortcut opening, the three tassel lifts and waking the butterfly. Retained loom/spring art does not authorize reinstating the superseded hold-to-weave or spring-only sequence. Each interaction starts on safe ground, has a short visible transformation, and completes before route movement resumes.

The shortcut awards no item. Its visible teal spool is the same second target later reached through the lifted tassels. The butterfly delivers gold to reachable ground, and only pickup changes the held count to 3/3. Do not confuse delivery, a route opening or a recovery animation with a new collectible event.

An open route stays open while either relevant runner can use it. Do not retract a carpet under Loop, lower a tassel on Purl during a lock or launch Snagling while the player must tap a fixed interaction.

## Enemy and rival

Implement the exact inventory rules from the gameplay spec, including the difference between losing the last thread and receiving a later hit while already at zero. A recoverable drop restores the same ID and never credits money. Keep the drop reachable and outside immediate repeat-contact danger. Use one damage event per attack and a short immunity interval.

Loop follows his own comparable tasks and collects his own three IDs. He can hesitate or make mistakes, but not teleport or receive score from unrelated player events. Simulate him while off-screen. Both first and second place are legitimate outcomes, and Purl can complete second with all three threads.

## Android integration and money boundary

Use safe-area-aware layout and meaningful touch targets. Contain-fit full reference pictures; adapt live scenes without hiding important characters, route edges or controls. The supplied `android/` host packages the same `scene/`, `approved/` and `assets/` folders and serves its local scene through WebViewAssetLoader. Preserve its native window-inset handling and `window.WishweaveVisual.pause()` lifecycle hook when extending the viewer. Compilation and real Android tests remain work to do. Do not describe an HTML preview or native source project as an APK or universal device compatibility.

Leave cash out locked and label demonstration account state appropriately. This package does not define a cash exchange rate or implement account authentication, reward settlement or payouts. Do not fabricate successful real transactions. Any future real-money integration must be a separate authenticated service, with gameplay state and account state kept distinct.

## Validation and delivery

Before declaring the completed game ready, record a full touch-controlled run, plus short evidence of a successful Snagling dodge and a hit/recovery branch. Capture the seven corresponding moments for comparison to the approved art. Test no-hit finish, recovery finish, one-to-zero continuation, already-zero failure, duplicate pickup protection, Loop first, Purl first, pause mid-interaction and background/resume.

Verify route continuity, tassel clearance, safe drops, inventory identity and Android system insets. Report devices and checks actually used. Do not copy a proposed check into a “passed” list without performing it. Include source, asset map, build instructions, an Android build only if actually produced, and a clear list of any remaining limitations.
