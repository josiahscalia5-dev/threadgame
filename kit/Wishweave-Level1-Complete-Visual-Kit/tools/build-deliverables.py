#!/usr/bin/env python3
"""Create compact, offline handoffs without modifying the approved PNGs.

Requires Python 3 and Pillow with WebP support. Run from any directory:
    python tools/build-deliverables.py

The full-quality PNGs remain in this kit. Only the image bytes embedded in
the small preview are resized/compressed. Atlas dimensions are preserved so
all existing frame rectangles remain valid. This script never builds a ZIP,
rewrites a manifest, or writes back to an original artwork file.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re

from PIL import Image, features


ROOT = Path(__file__).resolve().parents[1]
KIT_NAME = "Wishweave-Level1-Complete-Visual-Kit"
SOURCE_NAMES = ("asset-data.js", "scene-data.js", "app.js")
PREVIEW_NAME = "Preview-Wishweave-Level1-Complete-Small.html"
CLAUDE_NAME = "Wishweave-Level1-Complete-For-Claude.html"
BUNDLE_NAME = "CLAUDIA-COMPLETE-SOURCE.txt"
PROFILES = (
    # approved width/quality, scenery width/quality, atlas quality
    (600, 68, 540, 64, 72),
    (600, 65, 540, 61, 68),
    (580, 63, 520, 59, 65),
    (560, 60, 500, 56, 62),
    (560, 60, 500, 55, 60),
    (540, 57, 480, 54, 58),
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def replace_once(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise ValueError(f"Expected exactly one occurrence of {old!r}")
    return text.replace(old, new, 1)


def load_sources() -> dict[str, str]:
    names = ("index.html", "style.css", *SOURCE_NAMES)
    sources = {name: (ROOT / "scene" / name).read_text() for name in names}
    if "window.WW_EMBEDDED_ASSETS" not in sources["app.js"]:
        raise ValueError("The viewer must support window.WW_EMBEDDED_ASSETS.")
    return sources


def collect_images(sources: dict[str, str]) -> list[tuple[str, Path, str]]:
    """Collect scene plates and every runtime atlas, without unused art copies."""
    match = re.fullmatch(
        r"\s*window\.WW_ASSET_MANIFEST\s*=\s*(\{.*\})\s*;\s*",
        sources["asset-data.js"],
        re.S,
    )
    if not match:
        raise ValueError("asset-data.js must contain a JSON manifest assignment.")
    manifest = json.loads(match.group(1))
    scene_js = sources["scene-data.js"]
    app_js = sources["app.js"]
    approved = re.findall(r"approved\s*:\s*['\"]([^'\"]+)['\"]", scene_js)
    backgrounds = re.findall(r"background\s*:\s*['\"]([^'\"]+)['\"]", scene_js)
    if len(approved) != 7 or len(backgrounds) != 7:
        raise ValueError("The complete viewer must include all seven scene pairs.")
    if not all(word in scene_js for word in ("snagged", "recovery", "butterfly")):
        raise ValueError("The complete story must retain snagged/recovery/butterfly.")
    if "dodge" not in app_js or "hit" not in app_js:
        raise ValueError("The viewer must retain both encounter story branches.")

    # Entities and literal cropDraw calls are the viewer's atlas entry points.
    names = set(re.findall(r"asset\s*:\s*['\"]([^'\"]+)['\"]", scene_js))
    names.update(re.findall(r"cropDraw\(\s*['\"]([^'\"]+)['\"]", app_js))
    names.add("ui-atlas")
    image_map: dict[str, str] = dict.fromkeys(approved, "approved")
    image_map.update(dict.fromkeys(backgrounds, "scenery"))
    for name in sorted(names):
        spec = manifest["images"].get(name)
        if not spec or not spec.get("file"):
            raise ValueError(f"Current asset manifest is missing {name!r}.")
        image_map["../assets/" + spec["file"]] = "atlas"

    images = []
    for key, role in image_map.items():
        path = (ROOT / "scene" / key).resolve()
        if not path.is_relative_to(ROOT) or not path.is_file():
            raise ValueError(f"Missing or invalid image: {key}")
        if path.suffix.lower() != ".png":
            raise ValueError(f"Expected original PNG source: {key}")
        if role == "atlas":
            spec = next(v for v in manifest["images"].values()
                        if "../assets/" + v.get("file", "") == key)
            with Image.open(path) as im:
                if (im.width, im.height) != (spec["width"], spec["height"]):
                    raise ValueError(f"Stale dimensions in manifest: {key}")
        images.append((key, path, role))
    return images


def webp_bytes(path: Path, width: int | None, quality: int) -> bytes:
    with Image.open(path) as original:
        mode = "RGBA" if "A" in original.getbands() else "RGB"
        im = original.convert(mode)
        if width and im.width > width:
            height = round(im.height * width / im.width)
            im = im.resize((width, height), Image.Resampling.LANCZOS)
        stream = io.BytesIO()
        # Preview-only alpha compression trims the fine transparent-edge noise
        # in generated atlases. Geometry and canvas dimensions stay unchanged;
        # the kit's lossless source PNGs and alpha channels are never rewritten.
        im.save(stream, format="WEBP", quality=quality, alpha_quality=90, method=5)
        return stream.getvalue()


def add_note(html: str, note: str) -> str:
    css = (
        ".authoring-note{font-size:11px;line-height:1.65;color:#f7d4a2;"
        "border-left:2px solid #c19c62;padding-left:11px;margin:0 0 22px;"
        "overflow-wrap:anywhere}"
    )
    html = replace_once(html, "</style>", css + "\n</style>")
    marker = '<nav class="scene-tabs"'
    return replace_once(html, marker,
                        '<p class="authoring-note">' + note + "</p>\n      " + marker)


def inline_viewer(sources: dict[str, str], *, embedded=None, external=False) -> str:
    html = sources["index.html"]
    html = replace_once(html, '<link rel="stylesheet" href="style.css">',
                        "<style>\n" + sources["style.css"] + "\n</style>")
    for name in SOURCE_NAMES:
        js = sources[name]
        if external:
            js = js.replace("../assets/", KIT_NAME + "/assets/")
            js = js.replace("../approved/", KIT_NAME + "/approved/")
            js = js.replace(
                "Keep the scene, approved, and assets folders together, then reload.",
                "Place this HTML beside the unzipped " + KIT_NAME + " folder, then reload.")
        if "</script" in js.lower():
            raise ValueError(f"Unsafe inline script terminator in {name}.")
        script = "<script>\n/* Source: scene/" + name + " */\n" + js + "\n</script>"
        if embedded is not None and name == SOURCE_NAMES[0]:
            # Two scenes may deliberately share the identical clean landing.
            # Store its URL once, while retaining every original lookup key.
            unique, aliases, first_key = {}, {}, {}
            for key, value in embedded.items():
                if value in first_key:
                    aliases[key] = first_key[value]
                else:
                    first_key[value] = key
                    unique[key] = value
            script = ("<script>window.WW_EMBEDDED_ASSETS="
                      + json.dumps(unique, separators=(",", ":")) + ";"
                      + "".join("window.WW_EMBEDDED_ASSETS[" + json.dumps(key)
                                + "]=window.WW_EMBEDDED_ASSETS[" + json.dumps(value)
                                + "];" for key, value in aliases.items())
                      + "</script>\n" + script)
        html = replace_once(html, '<script src="' + name + '"></script>', script)
    if external:
        html = add_note(html,
            "<strong>Lightweight source for Claudia.</strong> All viewer code, scene data, "
            "and the asset manifest are included. Artwork loads from the original kit. "
            "Keep this file beside the unzipped <strong>" + KIT_NAME + "</strong> folder "
            "to preview it locally. This source file does not embed the images.")
        if re.search(r"data:image|base64", html, re.I):
            raise ValueError("The lightweight source must not embed artwork.")
    else:
        html = html.replace("APPROVED ART", "APPROVED PREVIEW")
        html = html.replace("Your approved screen, shown unchanged and fully visible.",
                            "Compressed preview of your approved screen. Unchanged, full-quality PNGs are in the complete kit.")
        html = html.replace("unchanged approved artwork", "compressed approved-art preview")
        html = add_note(html,
            "<strong>Compact offline preview.</strong> All seven scenes and three view modes "
            "are included. These embedded images are compressed for a smaller upload. "
            "The approved full-quality PNGs remain unchanged in the complete kit.")
    return html


def make_source_bundle(sources: dict[str, str]) -> str:
    chunks = [
        "WISHWEAVE WONDERS — COMPLETE LEVEL 1 VIEWER SOURCE\n"
        "This small text file contains all viewer code, seven-scene story data, and the asset manifest.\n"
        "Original PNGs and complete documentation are in the companion visual kit.\n"
        "Recreate the files below inside Wishweave-Level1-Complete-Visual-Kit/scene/.\n"
        "The ../approved/ and ../assets/ paths intentionally reference the companion folders.\n"
        "This is a visual authoring viewer, not an implemented gameplay or payout system.\n"
    ]
    for name in ("index.html", "style.css", *SOURCE_NAMES):
        chunks.append("\n" + "=" * 60 + "\nFILE: scene/" + name + "\n" + "=" * 60
                      + "\n" + sources[name])
    return "\n".join(chunks)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT.parent)
    parser.add_argument("--max-bytes", type=int, default=4_800_000,
                        help="Strictly smaller than this byte count; default leaves upload headroom.")
    args = parser.parse_args()
    if not 1_000_000 <= args.max_bytes <= 5_000_000:
        parser.error("--max-bytes must be between 1,000,000 and 5,000,000")
    if not features.check("webp"):
        raise SystemExit("Pillow requires WebP support to build the compact preview.")
    sources = load_sources()
    images = collect_images(sources)
    before = {str(path): sha256(path.read_bytes()) for _, path, _ in images}
    tiny_html = inline_viewer(sources, external=True).encode()
    bundle = make_source_bundle(sources).encode()
    if len(tiny_html) >= 100_000 or len(bundle) >= 100_000:
        raise SystemExit("The source-only handoff exceeded its 100 KB budget.")

    attempts = []
    for profile in PROFILES:
        aw, aq, bw, bq, tq = profile
        encoded, sizes = {}, {}
        for key, path, role in images:
            width, quality = ((aw, aq) if role == "approved" else
                              (bw, bq) if role == "scenery" else (None, tq))
            data = webp_bytes(path, width, quality)
            encoded[key] = "data:image/webp;base64," + base64.b64encode(data).decode("ascii")
            sizes[key] = len(data)
        html = inline_viewer(sources, embedded=encoded).encode()
        attempts.append({"profile": list(profile), "bytes": len(html)})
        if len(html) < args.max_bytes:
            break
    else:
        raise SystemExit("Unable to meet preview size budget: " + json.dumps(attempts))

    after = {str(path): sha256(path.read_bytes()) for _, path, _ in images}
    if before != after:
        raise SystemExit("An original image changed while exporting; stop and inspect it.")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    outputs = ((PREVIEW_NAME, html), (CLAUDE_NAME, tiny_html), (BUNDLE_NAME, bundle))
    result = {"source_kit": str(ROOT), "original_images_unchanged": True,
              "scenes": 7, "view_modes": 3, "story_routes": ["hit", "dodge"],
              "embedded_image_count": len(images),
              "unique_embedded_image_count": len(set(encoded.values())),
              "compression_profile": list(profile),
              "preview_alpha_quality": 90,
              "source_sha256": {name: sha256(value.encode()) for name, value in sources.items()},
              "profile_fields": ["approved_width", "approved_quality", "scenery_width", "scenery_quality", "atlas_quality"],
              "attempts": attempts, "embedded_webp_bytes": sizes, "files": []}
    for name, data in outputs:
        target = args.output_dir / name
        target.write_bytes(data)
        result["files"].append({"path": str(target), "bytes": len(data), "sha256": sha256(data)})
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
