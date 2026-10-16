#!/usr/bin/env python3
"""Check that the road the game builds from route data matches the kit's GLB walkable top.

  python3 tools/check-route-vs-glb.py

The game does not load the kit's level1-connected-layout.glb at runtime; it builds the road from route.json (the
kit's authoritative contract), via game/src/data/route.js. This tool reads the GLB's walkable-top meshes and, for
every vertex, measures:
  * lateral excess: how far the vertex lies outside the route-derived deck edge (|lateral| - width/2),
  * height error:   vertex y minus the route surface height at the same s,
and checks that the deck reaches both edges (max |lateral| close to width/2). Exit code 1 if any check fails.
"""
import json
import os
import struct
import sys

import numpy as np

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
KIT = os.path.join(REPO, 'kit', 'connected', 'Wishweave-Connected-World-Kit', 'scenery')
TOL = 0.02  # metres


def load_glb(path):
    data = open(path, 'rb').read()
    jlen = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack('<I', data[off:off + 4])[0]
    binary = data[off + 8:off + 8 + blen]
    return gltf, binary


def accessor(gltf, binary, idx):
    acc = gltf['accessors'][idx]
    view = gltf['bufferViews'][acc['bufferView']]
    start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[acc['type']]
    dtype = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[acc['componentType']]
    n = acc['count'] * comps
    arr = np.frombuffer(binary, dtype=dtype, count=n, offset=start)
    return arr.reshape(acc['count'], comps) if comps > 1 else arr


def road_frame(points):
    P = np.array([[p['x'], p['y'], p['z']] for p in points])
    S = np.array([p['s'] for p in points])
    T = np.array([p['tangent'] for p in points])
    W = np.array([p['width'] for p in points])
    return P, S, T, W


def measure(vertices, points):
    P, S, T, W = road_frame(points)
    out = []
    for v in vertices:
        # nearest centreline segment (horizontal)
        a, b = P[:-1], P[1:]
        e = b - a
        L2 = e[:, 0] ** 2 + e[:, 2] ** 2
        t = np.clip(((v[0] - a[:, 0]) * e[:, 0] + (v[2] - a[:, 2]) * e[:, 2]) / np.maximum(L2, 1e-12), 0, 1)
        cx, cz = a[:, 0] + e[:, 0] * t, a[:, 2] + e[:, 2] * t
        d = np.hypot(v[0] - cx, v[2] - cz)
        i = int(np.argmin(d))
        ti = t[i]
        c = a[i] + e[i] * ti
        tan = T[i] * (1 - ti) + T[i + 1] * ti
        tan /= np.linalg.norm(tan)
        right = np.array([-tan[2], 0, tan[0]])
        right /= np.linalg.norm(right)
        lateral = (v[0] - c[0]) * right[0] + (v[2] - c[2]) * right[2]
        width = W[i] * (1 - ti) + W[i + 1] * ti
        out.append((S[i] * (1 - ti) + S[i + 1] * ti, lateral, width, v[1] - c[1]))
    return np.array(out)


def main():
    gltf, binary = load_glb(os.path.join(KIT, 'level1-connected-layout.glb'))
    route = json.load(open(os.path.join(KIT, 'route.json')))
    roads = {
        'Road_Main_Continuous_Walkable_Top': route['mainRoute']['points'],
        'Road_Tassel_Bypass_Walkable_Top': route['branches'][0]['points'],
    }
    ok = True
    for node in gltf['nodes']:
        name = node.get('name')
        if name not in roads:
            continue
        mesh = gltf['meshes'][node['mesh']]
        verts = np.concatenate([accessor(gltf, binary, prim['attributes']['POSITION']) for prim in mesh['primitives']])
        if 'translation' in node:
            verts = verts + np.array(node['translation'])
        m = measure(verts, roads[name])
        excess = np.abs(m[:, 1]) - m[:, 2] / 2
        reach = np.abs(m[:, 1]).max()
        herr = np.abs(m[:, 3]).max()
        good = excess.max() <= TOL and herr <= TOL and reach >= m[:, 2].max() / 2 - TOL
        ok = ok and good
        print('%s: %d vertices | outside deck edge max %+.4f m | height error max %.4f m | edge reach %.3f of %.3f m | %s'
              % (name, len(verts), excess.max(), herr, reach, m[:, 2].max() / 2, 'OK' if good else 'FAIL'))
    print('route-vs-GLB:', 'PASS' if ok else 'FAIL', '(tolerance %.3f m)' % TOL)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
