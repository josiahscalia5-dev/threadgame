/* Wishweave Wonders — 3D renderer: the approved 2D art as billboards in the 3D course.

   The characters, spools, tassels, posts and flower gate are the user's own sprite frames (WW.ASSETS atlases built
   from the visual kit by tools/build-runtime-assets.py), drawn on upright quads that stand on their pivot (feet /
   base; tassels hang from their top) and turn about the vertical axis to face the camera. They are unlit and not tone
   mapped, so on screen they keep the exact colours of the approved art. Round objects (Purl, Loop, spools, posts,
   tassels) look the same from every side the chase camera can see them, so a vertical billboard is faithful.

     const A = WW.render.sprites.atlas(THREE, images, assets)
     A.texture(imgKey)                     THREE texture of an atlas image (cached)
     A.geometry(frameName, metresPerPx)    a quad with that frame's UVs, origin at the frame's pivot
     A.material(imgKey, opts)              unlit transparent material for that atlas
     A.frame(frameName)                    the frame record {img, x, y, w, h, px, py} */
(function (WW) {
  'use strict';
  const R = WW.render = WW.render || {};

  function atlas(THREE, images, assets) {
    const frames = (assets && assets.frames) || {};
    const specs = (assets && assets.images) || {};
    const tex = {}, mats = {}, geos = {};
    const owned = [];

    function texture(key) {
      if (tex[key]) return tex[key];
      const img = images && images[key];
      if (!img) throw new Error('Art image "' + key + '" is not loaded.');
      const t = new THREE.Texture(img);
      t.encoding = THREE.sRGBEncoding;
      t.anisotropy = 4;
      t.needsUpdate = true;
      owned.push(t);
      tex[key] = t;
      return t;
    }

    function frame(name) {
      const f = frames[name];
      if (!f) throw new Error('Art frame "' + name + '" is missing.');
      return f;
    }

    function geometry(name, k) {
      const key = name + '@' + k;
      if (geos[key]) return geos[key];
      const f = frame(name);
      const spec = specs[f.img] || {}, img = images && images[f.img];
      const W = spec.w || (img && img.width), H = spec.h || (img && img.height);
      const g = new THREE.PlaneGeometry(f.w * k, f.h * k);
      // move the pivot to the origin: x pivot px from the left, y pivot py from the top
      g.translate((f.w / 2 - f.px) * k, (f.py - f.h / 2) * k * -1 + 0, 0);
      g.translate(0, 0, 0);
      const uv = g.attributes.uv;
      const u0 = f.x / W, u1 = (f.x + f.w) / W, v1 = 1 - f.y / H, v0 = 1 - (f.y + f.h) / H;
      // PlaneGeometry uv order: (0,1) (1,1) (0,0) (1,0)
      uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
      uv.needsUpdate = true;
      owned.push(g);
      geos[key] = g;
      return g;
    }

    function material(key, opts) {
      opts = opts || {};
      const mkey = key + JSON.stringify(opts);
      if (mats[mkey]) return mats[mkey];
      const m = new THREE.MeshBasicMaterial({
        map: texture(key), transparent: true, alphaTest: opts.alphaTest == null ? 0.04 : opts.alphaTest,
        depthWrite: !!opts.depthWrite, side: THREE.DoubleSide, toneMapped: false, fog: opts.fog !== false
      });
      owned.push(m);
      mats[mkey] = m;
      return m;
    }

    return { texture: texture, geometry: geometry, material: material, frame: frame,
             dispose: function () { owned.forEach(function (o) { o.dispose(); }); } };
  }

  /* Rotate obj about Y so its +Z faces the camera position (cylindrical billboard). */
  function faceCamera(obj, camPos) {
    obj.rotation.y = Math.atan2(camPos.x - obj.position.x, camPos.z - obj.position.z);
  }

  R.sprites = { atlas: atlas, faceCamera: faceCamera };
})(globalThis.WW = globalThis.WW || {});
