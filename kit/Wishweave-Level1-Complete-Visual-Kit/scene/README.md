# Complete Level 1 visual walkthrough

Open `index.html` beside the supplied `approved` and `assets` folders. Everything uses local files; no server, font service, or network library is required.

The first view displays each approved PNG unchanged. **Scenery** displays the derived clean plate. **Layered** draws separate atlas sprites and interface over that plate; this is an editable composition, not a pixel-identical reconstruction of the approved image. Characters, props, and interface can be hidden independently.

The seven screens and the **Before this screen / Then what happens?** notes describe the complete level. The guided tour changes storyboard images every eight seconds. It does not simulate continuous running, collisions, pickups, an opponent, or payouts. The scene’s “Tap the stitch” labels are visual direction for future gameplay, not functioning game controls.

## Scene sequence

| Scene ID | Purl / Loop counts | What the frame shows |
| --- | --- | --- |
| `ribbon` | 0 / 0 | First stitch before the coral pickup |
| `shortcut` | 1 / 1 | Unfolding the carpet shortcut |
| `tassels` | 1 / 1 | Lifting the tassels before the teal pickup |
| `snagged` | 1 / 2 | Example hit after Purl had collected two threads |
| `recovery` | 2 / 2 | Recovering the same dropped teal thread |
| `butterfly` | 2 / 2 | Golden-thread delivery before collecting it |
| `finish` | 3 / 3 | Sample finish with Purl first |

The **Successful dodge** route goes from tassels to butterfly, skipping the hit and recovery images. The teal pickup occurs between the tassel frame and that encounter, so Purl carries two threads on either route into the butterfly section. A future playable version must determine finishing order from actual arrival times.

## Source contract

- `asset-data.js` defines `window.WW_ASSET_MANIFEST`, with an `images` object keyed by atlas name. Each atlas specifies `file` relative to `assets`, plus explicit `[x,y,width,height]` crop frames.
- `scene-data.js` defines `window.WW_SCENES`. Each scene contains `id`, `label`, `title`, `location`, `phase`, `approved`, `background`, `objective`, `counts`, `description`, `direction`, `before`, `after`, and `entities`. Optional `callout` and `action` fields control read-only interface artwork.
- An entity contains `id`, `kind` (`actors` or `props`), `asset`, `frame`, `x`, `y`, `width`, optional `rotation` in radians, and `z` painter order. Coordinates use the fixed **841 × 1870** design space. `x` is horizontal center, `y` is the bottom/feet anchor, and source aspect ratio is preserved.
- The plates retain carpet routes, attached stitch tabs, wooden structures, decorative textiles, and the flower gate. Stage three’s three active tassels and stage six’s butterfly plus carried spool are separate entities. The butterfly is `feature-atlas` frame 5, which already includes its suspended gold spool.
- `app.js` renders and navigates the visual storyboard. It contains no collision geometry or traversal system.
- A standalone export may define `window.WW_EMBEDDED_ASSETS`, mapping the existing relative file paths to data URLs. Without that object, the same viewer reads the ordinary files.

## Runtime API

`window.WishweaveVisual` exposes:

- `setScene(idOrIndex)` and `setMode('approved' | 'scenery' | 'layered')`
- `setRoute('hit' | 'dodge')`
- `setLayer('actors' | 'props' | 'hud', enabled)`
- `getState()`, `whenReady()`, `scenes`, and `designSize`
- `startWalkthrough()`, `stopWalkthrough()`, and `pause()` for a native host lifecycle

Rendering methods return promises. Listen for `wishweave:render` for the latest state. Programmatic navigation preserves the scroll position; mobile user navigation brings the selected preview into view. Artwork is contained proportionally within the available viewport, and the outside authoring controls scroll independently through the document.

Run `node tests/complete-visual.test.cjs` from the kit root with Playwright installed. Optional `WW_CHROMIUM_EXECUTABLE` selects a browser, `WW_CHROMIUM_MODULE` supplies specialized launch arguments, and `WW_STANDALONE_PATH` includes a standalone export in the same verification run.
