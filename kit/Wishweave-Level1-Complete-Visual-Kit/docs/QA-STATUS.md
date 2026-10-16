# Verification and delivery status

This release is the complete Level 1 visual handoff, not a continuous playable game.

- Seven approved screenshots are preserved byte-for-byte; SHA-256 values are in APPROVED-ART-HASHES.json.
- The full-quality local viewer passed 34 browser checks in Chromium 153, including all 21 scene/mode combinations, six viewports (320x568, 390x866, 412x915, 600x960, 800x412, 1365x950), layer toggles, both guided routes and mobile navigation. See ../tests/browser-checks.json.
- Both portable HTML exports passed all 21 scene/mode combinations, hit/dodge navigation and 390x866 framing, with zero failed requests, uncaught errors or external network requests. See ../tests/export-checks.json.
- All atlas dimensions/frame bounds and the 57 individual transparent image assets were checked. See asset-checks.json and individual-asset-checks.json.
- The two Snagling frame edge artifacts documented in individual-asset-checks.json are inherited from the supplied atlas; exact reference screenshots are unaffected.
- Android host source is included. No APK was compiled, and no emulator or physical Android device was tested. The screen-size checks above are browser viewport checks.
- There are no rigged 3D models, animation rigs, continuous connected 3D environment, gameplay physics, collision, rival AI, payout backend or live cash-out service in this visual kit.
- Clean plates and separate sprites are derived authoring art; they are not automatically pixel-identical replacements for the approved screenshots.

## Repeat the exports

Run `python3 tools/build-deliverables.py` from the kit. Requires Python 3 and Pillow with WebP support. It writes the small standalone review HTML, code-only HTML and source text to the parent directory. Only review copies are compressed; original PNGs remain unchanged.

Run `npm install`, then `npx playwright install chromium`, followed by `npm test` for local viewer checks. `node tests/export-preview.test.cjs` checks the exports. Optional WW_CHROMIUM_EXECUTABLE and WW_CHROMIUM_MODULE select an existing local browser. These are development verification steps, not app-player requirements.

Run `python3 tools/package-kit.py` after both test reports pass to package the ZIP and copy the Claudia prompt to the parent directory. It excludes private test captures and verifies archive CRC plus the original reference hashes.
