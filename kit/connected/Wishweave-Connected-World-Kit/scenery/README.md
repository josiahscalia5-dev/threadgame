# Wishweave Level 1 — connected spatial blockout

**BLOCKOUT ONLY.** `level1-connected-layout.glb` is real glTF 2.0 3D geometry: one continuous gently sloping main ribbon, one connected branch/rejoin, and named simple landmark geometry. It still needs approved textured ornamental production art matching the separate loomcity target. It is not a finished game or production scenery asset. There are no image plates, textures, rigged characters, colliders, AI, or controls.

## Files

- `level1-connected-layout.glb` — engine-neutral binary glTF spatial scaffold.
- `route.json` — authoritative centerlines, arc lengths, widths, sections, spawns, collectible positions, branch links, and finish coordinates.
- `course-overhead.svg` — exact X/Z overhead projection of the same route data.
- `validation.json` — generated topology, slope, continuity, mesh, and placement checks.
- `generate_course.py` — deterministic reusable generator; Python 3 and NumPy only.

Run `python generate_course.py --output .` from this directory to regenerate all outputs. The script defaults to its own directory. It overwrites only the listed generated outputs.

## Spatial contract

World units are meters, Y is up, and +Z is forward. Main route is 201.319 m long and 6 m wide; branch is 19.543 m long and 2.6 m wide. All `s` values are dense-reference 3D arc length in meters; summing the exported sample chords differs by less than 4 mm over each complete route. Main samples are at most 0.5 m apart; branch samples at most 0.25 m apart. `points` contain `x`, `y`, `z`, `s`, `width`, `tangent`, and `sectionId`. `y` is deck surface elevation. Interpolate between samples, then apply the controller's own grounded/foot offset. Tangent is unit 3D forward; horizontal right is `normalize([tangent.z, 0, -tangent.x])`.

`mainRoute.spawn` and `spawnPositions.player` are the same ground reference. `mainRoute.finish`, top-level `finish`, the Flowergate node origin, and `Finish_Trigger_Origin` use the same endpoint. The visible finish band extends 1.2 m backward from that endpoint with a tiny render offset. A controller should detect crossing the finish plane or `s >= mainRoute.length`, not proximity to a decorative support.

`branches[0].startS` and `endS` address the main route. Its `points[].s` is local branch distance; `points[].mainS` gives monotonically increasing equivalent main-route progress. The `from` and `to` positions exactly match main samples. `connectivity` explicitly links both junctions. The bypass intentionally overlaps the main deck at fork/rejoin to guarantee connected surface; collision union/baking and engine playtesting remain required. This is not a ready-made production collision mesh.

Six sections divide the same unbroken road; they are metadata ranges, not separate rooms. Landmark solids sit off the 6 m floor; arch/gate crossbars are overhead. The Snagling landing and butterfly banner are location placeholders, not characters or behavior. Collectible markers occur at 15% red, 52% teal, and 80% gold.

## Verification and handoff

Generated checks currently pass: max main slope 2.541°, max branch slope 0.197°, minimum main horizontal bend radius 23.124 m. The main ribbon outline has no self intersections. Mesh indices, nondegenerate faces, finite positions, and unit vertex normals are checked. These are geometric checks; visual fidelity, camera clearance, animation, physics, gameplay and accessibility still require implementation and engine review.

Use named nodes and route anchors to replace blockout masses with approved scenery while preserving the connected floor and all route coordinates. Gate supports leave more than 6 m clear; there are no rails or fall protection in this scaffold. Flat colors indicate object roles and are not final material decisions.
