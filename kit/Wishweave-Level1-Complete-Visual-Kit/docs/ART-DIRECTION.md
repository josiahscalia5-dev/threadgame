# Art direction — approved seven-screen level

## Fixed visual targets

The seven PNGs in `approved/` are the approved original compositions and must remain byte-identical. They define the theme, location, character silhouettes, color, lighting, rear camera and scene landmarks. The updated connected shortcut in `02-shortcut.png` is authoritative.

The six unique clean plates are derived authoring art for seven keyframes. The hit and recovery share the same landing. Plates and independent cutouts may differ in small generated details from the originals. Preserve those originals for comparison; do not rename a derived composition an exact screenshot match. The compressed sharing preview also does not replace the full-resolution approved PNGs.

This is 2D art, not rigged geometry. It includes no GLB/FBX models, animation rigs, UVs, traversable 3D world or complete frame-by-frame movement. A 2.5D game can use the supplied art with authored routes, depth layers, occlusion and animation. A 3D game needs corresponding models and rigs built to these visual references. Neither option is automatically pixel-identical during movement.

## World, characters and materials

Keep the magical suspended loom city: warm honey-colored wooden towers, tall hanging teal floral tapestries, coral and teal carpet ribbons, plum tassels, gold braided borders, glowing lanterns, clouds, waterfalls and the enormous flower gate. Raised embroidered flowers, chunky crochet and stitched edges create the rich handmade surface. The mood is cheerful, friendly and polished, with depth and detail that still let the player see the route.

Purl remains coral-red with one curled top tuft. Loop remains teal with two curled loops. Use short plush limbs and woven brown soles. Rear sprites are for gameplay; front poses belong in intentional menu/result moments, not running backward toward the viewer. Snagling stays a little plum tangle with a mischievous stitched expression. The butterfly is coral and gold embroidered fabric, emerging from a matching outline on the teal tapestry.

Keep warm sunlight, soft contact shadows and gold interaction highlights. Avoid glossy plastic characters, flat placeholder roads, a new island setting, unrelated animals or a reduced-detail generic runner. Excessive bloom must not hide the stitch target, spool or route edge.

## Per-screen composition

| Reference | Keep these landmarks and relationships |
|---|---|
| `01-ribbon.png` | Purl low on the coral approach; glowing stitch ahead/right of him; coral ribbon unfurling upward around the central wooden tower; coral spool high on that route; Loop on the separate right teal ribbon. |
| `02-shortcut.png` | Purl on the broad foreground landing; golden stitch at his right; visibly connected rolled-carpet shortcut ahead; far platform and teal-spool sightline; a large plum tassel; Loop on the right bypass. |
| `03-tassels.png` | Three distinct plum tassels suspended on gold ropes; upward lift motion; stitch near lower-right of Purl; raised round landing and teal spool ahead; Loop on the neighboring right route. |
| `04-snagged.png` | Wide safe floral landing; large left tower/post; Snagling peeking from the left; loose yarn around Purl's ankles; dropped teal spool on reachable carpet to the right; Loop farther ahead/right. |
| `05-recovery.png` | Same location and route as 04; Purl regains the same teal spool; subtle golden recovery effect; Snagling releases the yarn and recedes; Loop continues. |
| `06-butterfly.png` | Tall teal floral tapestry on the left; matching butterfly outline and stitch fitting; coral/gold butterfly carrying gold spool to connected carpet terrace; Purl approaching from below; Loop on the right. |
| `07-finish.png` | Huge illuminated embroidered flower gate in its wooden loom ring; continuous approach/finish terrace; rear-view racers; celebratory petals; true rank and replay action. |

Show intermediate travel using the same tower scale, carpet edge treatment and recurring landmarks. Do not turn these into disconnected teleporting rooms. Both the ribbon and shortcut must visibly attach to a reachable surface. The three-tassel platform and butterfly collection area also require a physically continuous approach.

## Camera, depth and movement

Use portrait framing behind and slightly above Purl. His back faces the viewer and he travels into the world. During normal play his feet generally sit near 76–80% of the action image height, with the complete body and tuft visible. Scene 07 reframes both racers to show the gate. Match the reference's individual composition instead of forcing identical screen coordinates for every scene.

Loop should scale with distance and occupy his independent route. Do not pin him to the same screen position or size throughout the race. A tower can hide him temporarily, but his return must agree with his route progress.

Organize distant city/sky, middle towers and carpets, moving characters/props, foreground occluders and interface as distinct rendering layers. Use contact shadows and stable feet anchors. Character animation needs alternating steps and intentional poses; bobbing a single still frame is not a production running cycle. Tapestry butterflies need a flap/emergence sequence; an independent cutout alone is not the entire effect.

## Interface

Preserve cream stitched HUD panels with warm brown text, coral Purl accents, teal Loop accents and the coral/teal embroidered title. Keep the pause control compact at upper-right. The scores display each racer's actual held count independently. Stitch cues are contextual and point to a reachable world touch target.

Saved rewards occupy a slim bottom strip. Keep its locked cash-out control secondary and outside the Android gesture/navigation inset. Do not create a large permanent action panel that covers Purl or the approach. The revised interactions use tap cues; the old HOLD TO WEAVE panel is not part of this sequence.

The approved PNGs contain sample numbers and labels. Keep them unchanged in reference mode. For playable or layered views, use clean plates and draw one live interface from game state. Do not put a second score over baked text, animate a duplicate Purl over an already painted Purl, or show +1 recovery as a new monetary reward.

## Android layout

Maintain a fixed authoring coordinate space mapped to the actual safe content rectangle. Preserve image aspect ratio. Contain-fit the whole approved reference when displaying it; fill extra space with compatible decorative framing rather than cutting off characters or UI. For live scenes, background scenery may bleed, but the critical route, targets, character silhouettes and controls must remain visible.

Apply real top/bottom system insets and allow the HUD to reflow on compact screens. Keep touch targets away from operating-system edge gestures. On wide screens or landscape, a centered portrait play area is acceptable until a dedicated layout exists. Test real Android input, cutouts and gesture navigation before claiming device support. Browser viewport checks alone do not establish compatibility with every Android phone.

## Import and preservation

Use `assets/manifest.json` and other supplied asset metadata for actual file paths, dimensions, frame rectangles and roles. Import transparent art as RGBA and retain clean alpha edges. Atlas frames can have different occupied bounds; do not assume equal cells are the visible sprite dimensions. Apply stable bottom-center feet pivots with per-pose adjustment where needed.

The kit carries the existing character, enemy, props, interaction and UI atlases plus revised feature art. Some retained poses or props support authoring but are not a requirement to reintroduce old mechanics. Use the new ribbon/shortcut/tassel/butterfly sequence as the design source. Keep original assets intact and put resized/compressed runtime derivatives in separate outputs.

The early Snagling cameo in the shortcut reference is non-attacking foreshadowing. Its real attack is reserved for the broad landing after the teal pickup. Matching score counts in references illustrate one run, not forced synchronization.
