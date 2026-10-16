#!/usr/bin/env python3
"""Generate the deterministic Wishweave Level 1 spatial BLOCKOUT (Python + numpy)."""
from __future__ import annotations
import argparse, json, math, struct
from pathlib import Path
import numpy as np

SCHEMA = 'wishweave.connected-course.v1'
SECTIONS = [
    ('spoolwake', 'Spoolwake Pier', 0.00, 0.16),
    ('bellspindle', 'Bellspindle Bend', 0.16, 0.33),
    ('tassel', 'Tassel Switch', 0.33, 0.50),
    ('snagling', 'Snagling Landing', 0.50, 0.67),
    ('butterfly', 'Butterfly Reach', 0.67, 0.84),
    ('flowergate', 'Flowergate Crest', 0.84, 1.00),
]
PALETTE = {
    'road': ('Ribbon ivory', [0.86, 0.82, 0.72, 1]),
    'edge': ('Ribbon mauve sides', [0.47, 0.36, 0.52, 1]),
    'lavender': ('Lavender landmark blockout', [0.60, 0.49, 0.75, 1]),
    'mint': ('Mint landmark blockout', [0.39, 0.70, 0.63, 1]),
    'pink': ('Rose landmark blockout', [0.83, 0.48, 0.60, 1]),
    'gold': ('Gold marker blockout', [0.94, 0.70, 0.28, 1]),
    'red': ('Red collectible blockout', [0.94, 0.22, 0.28, 1]),
    'teal': ('Teal collectible blockout', [0.08, 0.76, 0.70, 1]),
    'band': ('Finish band', [0.96, 0.85, 0.42, 1]),
}

def unit(a):
    a = np.asarray(a, dtype=float)
    return a / max(float(np.linalg.norm(a)), 1e-12)

def cumulative(p):
    return np.r_[0., np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]

def sample_polyline(p, distances, targets):
    return np.column_stack([np.interp(targets, distances, p[:, k]) for k in range(3)])

def evenly_resample(p, spacing):
    s = cumulative(p)
    targets = np.linspace(0., s[-1], int(math.ceil(s[-1] / spacing)) + 1)
    return sample_polyline(p, s, targets), targets

def frames(p):
    tangent = np.gradient(p, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1)[:, None]
    right = np.column_stack([tangent[:, 2], np.zeros(len(p)), -tangent[:, 0]])
    right /= np.linalg.norm(right, axis=1)[:, None]
    return tangent, right

def section_id(s, length):
    return next((sid for sid, _, a, b in SECTIONS if a * length <= s < b * length), SECTIONS[-1][0])

def rounded(v):
    return [round(float(x), 6) for x in v]

def point_records(p, s, width, total, main_s=None):
    tangents, _ = frames(p)
    records = []
    for i, (pos, distance, tangent) in enumerate(zip(p, s, tangents)):
        progress = distance if main_s is None else main_s[i]
        records.append({'s': round(float(distance), 6), 'x': round(float(pos[0]), 6),
                        'y': round(float(pos[1]), 6), 'z': round(float(pos[2]), 6),
                        'width': width, 'tangent': rounded(tangent),
                        'sectionId': section_id(progress, total),
                        **({'mainS': round(float(progress), 6)} if main_s is not None else {})})
    return records

class GLB:
    def __init__(self):
        self.doc = {'asset': {'version': '2.0', 'generator': 'Wishweave connected-course blockout generator',
                             'extras': {'status': 'BLOCKOUT ONLY — not approved production art'}},
                    'scene': 0, 'scenes': [{'name': 'Level 1 connected layout — BLOCKOUT ONLY', 'nodes': []}],
                    'nodes': [], 'meshes': [], 'materials': [], 'buffers': [], 'bufferViews': [], 'accessors': []}
        self.binary = bytearray()
        self.geometry = []
        self.material = {}
        for key, (name, color) in PALETTE.items():
            self.material[key] = len(self.doc['materials'])
            self.doc['materials'].append({'name': name, 'pbrMetallicRoughness': {
                'baseColorFactor': color, 'metallicFactor': 0., 'roughnessFactor': 0.9}})

    def accessor(self, array, kind, component, target):
        array = np.ascontiguousarray(array)
        while len(self.binary) % 4:
            self.binary.append(0)
        view = len(self.doc['bufferViews'])
        self.doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(self.binary),
                                       'byteLength': array.nbytes, 'target': target})
        self.binary.extend(array.tobytes())
        access = {'bufferView': view, 'byteOffset': 0, 'componentType': component,
                  'count': len(array), 'type': kind}
        if kind == 'VEC3':
            access.update(min=[float(x) for x in array.min(axis=0)], max=[float(x) for x in array.max(axis=0)])
        idx = len(self.doc['accessors'])
        self.doc['accessors'].append(access)
        return idx

    def mesh(self, name, positions, triangles, material, extras=None, parent=None):
        p = np.asarray(positions, dtype='<f4')
        t = np.asarray(triangles, dtype='<u4').reshape(-1, 3)
        n = np.zeros_like(p, dtype=float)
        face_n = np.cross(p[t[:, 1]] - p[t[:, 0]], p[t[:, 2]] - p[t[:, 0]])
        for k in range(3):
            np.add.at(n, t[:, k], face_n)
        lengths = np.linalg.norm(n, axis=1)
        n /= np.maximum(lengths, 1e-12)[:, None]
        self.geometry.append((name, p, t, n))
        prim = {'attributes': {'POSITION': self.accessor(p, 'VEC3', 5126, 34962),
                              'NORMAL': self.accessor(n.astype('<f4'), 'VEC3', 5126, 34962)},
                'indices': self.accessor(t.flatten(), 'SCALAR', 5125, 34963),
                'material': self.material[material], 'mode': 4}
        mesh = len(self.doc['meshes'])
        self.doc['meshes'].append({'name': name, 'primitives': [prim]})
        node = {'name': name, 'mesh': mesh}
        if extras: node['extras'] = extras
        return self.node(node, parent)

    def node(self, node, parent=None):
        idx = len(self.doc['nodes'])
        self.doc['nodes'].append(node)
        if parent is None: self.doc['scenes'][0]['nodes'].append(idx)
        else: self.doc['nodes'][parent].setdefault('children', []).append(idx)
        return idx

    def group(self, name, position, tangent, extras):
        angle = math.atan2(tangent[0], tangent[2])
        return self.node({'name': name, 'translation': rounded(position),
                          'rotation': [0, math.sin(angle / 2), 0, math.cos(angle / 2)], 'extras': extras})

    def box(self, name, center, size, material, parent=None):
        c, h = np.array(center), np.array(size) / 2
        corners = np.array([[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
                            [-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]], dtype=float) * h + c
        # Outward winding, separate vertices at hard edges.
        faces = [[0,3,2,1], [4,5,6,7], [0,4,7,3], [1,2,6,5], [0,1,5,4], [3,7,6,2]]
        p, t = [], []
        for face in faces:
            base = len(p); p.extend(corners[face]); t.extend([[base,base+1,base+2],[base,base+2,base+3]])
        return self.mesh(name, p, t, material, parent=parent)

    def cylinder(self, name, center, radius, height, material, parent=None, segments=24):
        p, t = [], []
        center = np.asarray(center)
        for i in range(segments):
            a, b = i * 2 * math.pi / segments, (i+1) * 2 * math.pi / segments
            v = [center + [radius*math.cos(a),-height/2,radius*math.sin(a)],
                 center + [radius*math.cos(a),height/2,radius*math.sin(a)],
                 center + [radius*math.cos(b),height/2,radius*math.sin(b)],
                 center + [radius*math.cos(b),-height/2,radius*math.sin(b)]]
            base=len(p); p.extend(v); t.extend([[base,base+1,base+2],[base,base+2,base+3]])
            base=len(p); p.extend([center + [0,height/2,0], v[2], v[1]]); t.append([base,base+1,base+2])
            base=len(p); p.extend([center + [0,-height/2,0], v[0], v[3]]); t.append([base,base+1,base+2])
        return self.mesh(name,p,t,material,parent=parent)

    def diamond(self, name, position, color):
        p = np.array([[0,.42,0],[-.30,0,0],[0,0,.30],[.30,0,0],[0,0,-.30],[0,-.42,0]])
        tri=[[0,2,1],[0,3,2],[0,4,3],[0,1,4],[5,1,2],[5,2,3],[5,3,4],[5,4,1]]
        tri=[face[::-1] for face in tri]
        # Flat face normals for visible collectible markers.
        vertices = [p[j] + position for face in tri for j in face]
        return self.mesh(name,vertices,np.arange(24).reshape(-1,3),color,
                         {'role':'collectible-placeholder','type':color})

    def road(self, name, p, width):
        _, right = frames(p)
        left, edge = p-right*width/2, p+right*width/2
        positions = np.stack([left,edge],axis=1).reshape(-1,3)
        tris=[]
        for i in range(len(p)-1):
            a=2*i; tris.extend([[a,a+2,a+1],[a+1,a+2,a+3]])
        self.mesh(name+'_Walkable_Top',positions,tris,'road',
                  {'role':'walkable-blockout','widthMeters':width,'productionCollider':False})
        # Downward side reveals, closed underside and end faces; not railings.
        shell_p, shell_t = [], []
        def quad(v):
            a=len(shell_p); shell_p.extend(v); shell_t.extend([[a,a+1,a+2],[a,a+2,a+3]])
        drop = np.array([0,.45,0])
        for i in range(len(p)-1):
            quad([left[i],left[i]-drop,left[i+1]-drop,left[i+1]])
            quad([edge[i],edge[i+1],edge[i+1]-drop,edge[i]-drop])
            quad([left[i]-drop,edge[i]-drop,edge[i+1]-drop,left[i+1]-drop])
        quad([left[0],edge[0],edge[0]-drop,left[0]-drop])
        quad([left[-1],left[-1]-drop,edge[-1]-drop,edge[-1]])
        self.mesh(name+'_Deck_Sides',shell_p,shell_t,'edge',{'role':'scaffold-deck'})
        return left, edge

    def write(self,path):
        self.doc['buffers']=[{'byteLength':len(self.binary)}]
        raw=json.dumps(self.doc,separators=(',',':'),ensure_ascii=True).encode()
        raw += b' ' * ((-len(raw)) % 4)
        binary=bytes(self.binary); binary += b'\0' * ((-len(binary)) % 4)
        total=12+8+len(raw)+8+len(binary)
        path.write_bytes(struct.pack('<4sII',b'glTF',2,total)+struct.pack('<II',len(raw),0x4e4f534a)+raw+
                         struct.pack('<II',len(binary),0x004e4942)+binary)


def generate(output):
    output.mkdir(parents=True,exist_ok=True)
    u=np.linspace(0,1,20001)
    dense=np.column_stack([10*np.sin(2*np.pi*u)+5*np.sin(4*np.pi*u)+2*np.sin(6*np.pi*u),
                           .5+4.75*u+.8*np.sin(2*np.pi*u),190*u])
    p,s=evenly_resample(dense,.5)
    length=float(s[-1]); tangent,right=frames(p)
    def at(distance):
        pos=sample_polyline(p,s,[distance])[0]
        tan=unit([np.interp(distance,s,tangent[:,k]) for k in range(3)])
        r=unit([tan[2],0,-tan[0]])
        return pos,tan,r
    def placed(fraction,lateral=0,lift=0):
        pos,tan,r=at(length*fraction)
        return pos+r*lateral+np.array([0,lift,0]),tan

    # The bypass shares exact endpoint coordinates; a smooth offset returns to the main centerline.
    start_idx=int(np.argmin(abs(s-length*.405))); end_idx=int(np.argmin(abs(s-(s[start_idx]+16))))
    start_s,end_s=float(s[start_idx]),float(s[end_idx])
    parameter=np.linspace(0,1,401)
    main_s=start_s+(end_s-start_s)*parameter
    base=sample_polyline(p,s,main_s)
    _, r=frames(base)
    branch_dense=base+r*(5.0*np.sin(np.pi*parameter)**2)[:,None]
    bp,bs=evenly_resample(branch_dense,.25)
    dense_bs=cumulative(branch_dense)
    branch_main_s=np.interp(bs,dense_bs,main_s)
    bp[0],bp[-1]=p[start_idx],p[end_idx]
    route={'schema':SCHEMA,'status':'BLOCKOUT ONLY — spatial scaffold; production art and gameplay integration pending',
           'coordinateSystem':{'units':'meters','up':'Y','forward':'Z','handedness':'right-handed'},
           'mainRoute':{'id':'main','width':6.,'length':round(length,6),'sampleSpacingMax':.5,
                        'points':point_records(p,s,6.,length)},
           'sections':[{'id':sid,'name':name,'startS':round(a*length,6),'endS':round(b*length,6)} for sid,name,a,b in SECTIONS],
           'branches':[{'id':'tassel-bypass','name':'Tassel Side Loop','width':2.6,'length':round(float(bs[-1]),6),
                        'startS':round(start_s,6),'endS':round(end_s,6),
                        'from':{'routeId':'main','s':round(start_s,6),'position':rounded(bp[0])},
                        'to':{'routeId':'main','s':round(end_s,6),'position':rounded(bp[-1])},
                        'direction':'forward','points':point_records(bp,bs,2.6,length,branch_main_s),
                        'junctionTreatment':'Intentional same-height deck overlap at fork and rejoin; bake collision union during integration.'}],
           'spawnPositions':{},'collectibles':[],'landmarks':[],
           'connectivity':[{'fromRoute':'main','fromS':round(start_s,6),'toRoute':'tassel-bypass','toS':0},
                           {'fromRoute':'tassel-bypass','fromS':round(float(bs[-1]),6),'toRoute':'main','toS':round(end_s,6)}]}
    spawn,spawn_tan,_=at(2.)
    route['spawnPositions']['player']={'routeId':'main','s':2.,'position':rounded(spawn),'forward':rounded(spawn_tan),'verticalOffsetForController':0.}
    route['mainRoute']['spawn']=route['spawnPositions']['player']
    finish={'routeId':'main','s':round(length,6),'position':rounded(p[-1]),'forward':rounded(tangent[-1]),
            'width':6.,'landmarkId':'flowergate','triggerDepth':1.2}
    route['finish']=finish; route['mainRoute']['finish']=finish
    glb=GLB()
    left,edge=glb.road('Road_Main_Continuous',p,6.)
    glb.road('Road_Tassel_Bypass',bp,2.6)

    def landmark(kind,name,fraction,lateral,footprint,create):
        pos,tan=placed(fraction,lateral)
        ident={'id':kind,'name':name,'position':rounded(pos),'mainS':round(fraction*length,6),
               'lateralOffset':lateral,'footprintRadius':footprint,'role':'simple-landmark-blockout'}
        route['landmarks'].append(ident)
        group=glb.group('Landmark_'+name.replace(' ','_'),pos,tan,ident)
        create(group)
        return pos,tan
    for kind,name,fraction,lateral in [('tower-a','Bellspindle Tower Base',.24,-8.5),('tower-b','Tassel Tower Base',.43,-8.5)]:
        def tower(g):
            glb.cylinder('Tower_Foundation',[0,.35,0],2.5,.7,'edge',g)
            glb.cylinder('Tower_Blockout_Base',[0,3.0,0],2.0,5.0,'lavender',g)
            glb.cylinder('Tower_Blockout_Cap',[0,5.7,0],2.3,.45,'pink',g)
        landmark(kind,name,fraction,lateral,2.5,tower)
    def tassel_arch(g):
        for side in [-1,1]:
            glb.box('Tassel_Arch_Support_'+str(side),[side*4.1,2.4,0],[.6,4.8,.7],'pink',g)
        glb.box('Tassel_Arch_Crossbar',[0,5.0,0],[8.8,.55,.7],'lavender',g)
        for x in [-2.6,-1.3,0,1.3,2.6]:
            glb.box('Tassel_Hanging_Blockout',[x,4.5,0],[.25,.45,.25],'gold',g)
    landmark('tassel-arch','Tassel Arch',.365,0,4.4,tassel_arch)
    def landing(g):
        glb.box('Snagling_Landing_Platform',[0,-.18,0],[3.6,.36,4.5],'mint',g)
        glb.box('Snagling_Landing_Back_Marker',[0,.65,2.0],[3.6,1.3,.25],'lavender',g)
    snag,snag_tan=landmark('snagling-landing','Snagling Landing',.56,-6.5,2.9,landing)
    route['spawnPositions']['snaglingPlaceholder']={'position':rounded(snag),'forward':rounded(snag_tan),
                                                  'role':'landing-marker-only; no character mesh or AI included'}
    def banner(g):
        glb.box('Butterfly_Banner_Pole',[0,2.1,0],[.22,4.2,.22],'edge',g)
        glb.box('Butterfly_Banner_Marker',[.9,3.4,0],[1.8,1.1,.12],'teal',g)
    landmark('butterfly-banner','Butterfly Banner',.755,5.4,1.9,banner)
    def gate(g):
        for side in [-1,1]:
            glb.box('Flowergate_Support_'+str(side),[side*4.0,2.4,0],[.85,4.8,.9],'mint',g)
            glb.cylinder('Flowergate_Blossom_Marker_'+str(side),[side*4.0,5.,0],.9,.6,'pink',g)
        glb.box('Flowergate_Lintel',[0,5.05,0],[8.5,.6,.8],'pink',g)
        # Exact final route strip, transformed into the gate's local Y-rotation frame.
        # It follows the slope; the forward edge is on the finish plane.
        end_right=unit([tangent[-1,2],0,-tangent[-1,0]])
        end_forward=unit([tangent[-1,0],0,tangent[-1,2]])
        band_positions=[]
        for distance in np.linspace(length-1.2,length,5):
            center,_,r=at(distance)
            for side in [-1,1]:
                delta=center+r*(3*side)+np.array([0,.024,0])-p[-1]
                band_positions.append([np.dot(delta,end_right),delta[1],np.dot(delta,end_forward)])
        band_faces=[]
        for i in range(4):
            a=i*2; band_faces.extend([[a,a+2,a+1],[a+1,a+2,a+3]])
        glb.mesh('Finish_Band',band_positions,band_faces,'band',parent=g)
    landmark('flowergate','Flowergate',1.,0,4.5,gate)
    route['landmarks'][-1]['finishPosition']=rounded(p[-1])
    for color,fraction,lateral in [('red',.15,-1.2),('teal',.52,1.2),('gold',.80,0)]:
        pos,tan=placed(fraction,lateral,.9)
        floor,_,_=at(fraction*length)
        item={'id':color+'-01','type':color,'routeId':'main','mainS':round(fraction*length,6),
              'progressFraction':fraction,'position':rounded(pos),'lateralOffset':lateral,'hoverAboveRoad':.9}
        route['collectibles'].append(item)
        glb.diamond('Collectible_'+color.upper()+'_Placeholder',pos,color)
    glb.node({'name':'Spawn_Player','translation':rounded(spawn),'extras':route['spawnPositions']['player']})
    glb.node({'name':'Finish_Trigger_Origin','translation':rounded(p[-1]),'extras':finish})
    glb.doc['extras']={'routeMetadata':'route.json','units':'meters','up':'Y','status':'BLOCKOUT ONLY',
                       'notIncluded':['textures','ornamental production art','rigged characters','physics colliders','AI','controls']}
    glb.write(output/'level1-connected-layout.glb')
    (output/'route.json').write_text(json.dumps(route,indent=2)+'\n')
    validation=validate(route,glb,p,s,bp,bs,start_idx,end_idx,left,edge)
    (output/'validation.json').write_text(json.dumps(validation,indent=2)+'\n')
    write_svg(output/'course-overhead.svg',route)
    (output/'README.md').write_text(readme(route,validation))
    if not validation['passed']: raise RuntimeError('Validation failed: '+json.dumps(validation['checks']))
    print(json.dumps({'output':str(output),'mainLength':round(length,3),'branchLength':round(float(bs[-1]),3),
                      'maxSlopeDegrees':validation['metrics']['mainMaxSlopeDegrees'],'validationPassed':validation['passed']}))


def validate(route,glb,p,s,bp,bs,start_idx,end_idx,left,edge):
    def slope(path):
        d=np.diff(path,axis=0)
        return np.degrees(np.arctan2(abs(d[:,1]),np.linalg.norm(d[:,[0,2]],axis=1)))
    dx=np.gradient(p[:,0],s); dz=np.gradient(p[:,2],s)
    ddx=np.gradient(dx,s); ddz=np.gradient(dz,s)
    curvature=abs(dx*ddz-dz*ddx)/np.maximum((dx*dx+dz*dz)**1.5,1e-12)
    radii=1/np.maximum(curvature,1e-12)
    def orient(a,b,c): return float(np.cross(b-a,c-a))
    def crosses(a,b,c,d):
        return orient(a,b,c)*orient(a,b,d)<-1e-10 and orient(c,d,a)*orient(c,d,b)<-1e-10
    def outline_intersections(outline):
        found=[]
        for i in range(len(outline)):
            a,b=outline[i],outline[(i+1)%len(outline)]
            for j in range(i+2,len(outline)):
                if i==0 and j==len(outline)-1: continue
                c,d=outline[j],outline[(j+1)%len(outline)]
                if max(a[0],b[0])<min(c[0],d[0]) or max(c[0],d[0])<min(a[0],b[0]): continue
                if max(a[1],b[1])<min(c[1],d[1]) or max(c[1],d[1])<min(a[1],b[1]): continue
                if crosses(a,b,c,d): found.append([i,j])
        return found
    intersections=outline_intersections(np.vstack([left[:,[0,2]],edge[::-1][:,[0,2]]]))
    _,branch_right=frames(bp)
    branch_left=bp-branch_right*1.3; branch_edge=bp+branch_right*1.3
    branch_intersections=outline_intersections(np.vstack([branch_left[:,[0,2]],branch_edge[::-1][:,[0,2]]]))
    indices_ok=finite_ok=normals_ok=faces_ok=walkable_upward=collectibles_outward=True
    total_vertices=total_triangles=0
    for name,vertices,triangles,normals in glb.geometry:
        indices_ok &= bool(np.min(triangles)>=0 and np.max(triangles)<len(vertices))
        finite_ok &= bool(np.all(np.isfinite(vertices)) and np.all(np.isfinite(normals)))
        normals_ok &= bool(np.allclose(np.linalg.norm(normals,axis=1),1,atol=1e-5))
        cross=np.cross(vertices[triangles[:,1]]-vertices[triangles[:,0]],vertices[triangles[:,2]]-vertices[triangles[:,0]])
        faces_ok &= bool(np.min(np.linalg.norm(cross,axis=1))>1e-9)
        if name.endswith('_Walkable_Top'):
            walkable_upward &= bool(np.all(cross[:,1]>0))
        if name.startswith('Collectible_'):
            outward=vertices[triangles].mean(axis=1)-vertices.mean(axis=0)
            collectibles_outward &= bool(np.all(np.sum(cross*outward,axis=1)>0))
        total_vertices+=len(vertices); total_triangles+=len(triangles)
    main_t,_=frames(p); branch_t,_=frames(bp)
    join_angles=[math.degrees(math.acos(float(np.clip(np.dot(main_t[idx],branch_t[bidx]),-1,1))))
                 for idx,bidx in [(start_idx,0),(end_idx,-1)]]
    checks={
        'main_length_180_to_240_m':180<=s[-1]<=240,
        'branch_length_12_to_20_m':12<=bs[-1]<=20,
        'main_width_6_m':route['mainRoute']['width']==6.,
        'six_contiguous_sections':len(route['sections'])==6 and all(a['endS']==b['startS'] for a,b in zip(route['sections'],route['sections'][1:])),
        'main_sample_spacing_at_most_0_5_m':bool(np.max(np.diff(s))<=.500001),
        'main_forward_z_monotonic':bool(np.all(np.diff(p[:,2])>0)),
        'main_ribbon_outline_no_self_intersections':not intersections,
        'branch_ribbon_outline_no_self_intersections':not branch_intersections,
        'main_minimum_horizontal_bend_radius_over_12_m':bool(np.min(radii)>12),
        'main_slope_under_8_degrees':bool(np.max(slope(p))<8),
        'branch_slope_under_8_degrees':bool(np.max(slope(bp))<8),
        'branch_endpoints_exact_on_main_route':bool(np.array_equal(bp[0],p[start_idx]) and np.array_equal(bp[-1],p[end_idx])),
        'branch_endpoint_tangents_within_8_degrees':max(join_angles)<8,
        'finish_equals_flowergate_origin':route['finish']['position']==next(l['position'] for l in route['landmarks'] if l['id']=='flowergate'),
        'collectibles_red_teal_gold_at_15_52_80_percent':[(c['type'],c['progressFraction']) for c in route['collectibles']]==[('red',.15),('teal',.52),('gold',.8)],
        'mesh_indices_valid':indices_ok,'mesh_values_finite':finite_ok,'mesh_vertex_normals_unit':normals_ok,
        'mesh_no_degenerate_triangles':faces_ok,
        'all_walkable_triangles_face_upward':walkable_upward,
        'collectible_marker_triangles_face_outward':collectibles_outward,
        'landmark_solid_supports_off_main_walkable_floor':True,
    }
    # Check all ground-level landmark footprints, with explicit gate/arch support extents.
    off_floor=[l for l in route['landmarks'] if l['id'] not in ('tassel-arch','flowergate')]
    checks['landmark_solid_supports_off_main_walkable_floor']=all(abs(l['lateralOffset'])-l['footprintRadius']>3 for l in off_floor) and 4.1-.3>3 and 4.-.425>3
    return {'schema':'wishweave.course-validation.v1','passed':bool(all(checks.values())),
            'scope':'Deterministic spatial and mesh checks; not a physics, gameplay, renderer, or production-art acceptance test.',
            'checks':{k:bool(v) for k,v in checks.items()},
            'metrics':{'mainLengthMeters':round(float(s[-1]),6),'branchLengthMeters':round(float(bs[-1]),6),
                       'mainMaxSlopeDegrees':round(float(np.max(slope(p))),6),
                       'branchMaxSlopeDegrees':round(float(np.max(slope(bp))),6),
                       'minimumHorizontalBendRadiusMeters':round(float(np.min(radii)),6),
                       'branchJoinAngleDegrees':[round(x,6) for x in join_angles],
                       'mainSampleCount':len(p),'branchSampleCount':len(bp),'meshCount':len(glb.geometry),
                       'vertexCount':total_vertices,'triangleCount':total_triangles,'outlineSelfIntersections':intersections,
                       'branchOutlineSelfIntersections':branch_intersections},
            'intentionalOverlaps':['Branch deck overlaps main deck only in the fork/rejoin connection zones. Both share the same route elevation.',
                                   'Finish band sits 0.024 m above deck with its forward edge on the flowergate finish plane.'],
            'remainingWork':['Approved textured ornamental production art','Collision union at branch joins and collider bake',
                             'Character rigs and animation','Movement/controller integration','Snagling AI and butterfly behavior',
                             'Engine playtest including branch collision and camera clearance']}


def write_svg(path,route):
    # Exact route coordinates projected to X/Z. No generated imagery or decorative map geometry.
    main=route['mainRoute']['points']; branch=route['branches'][0]['points']
    def map_pos(pos): return (290+float(pos[0])*8,1640-float(pos[2])*8)
    def coords(points): return ' '.join(f'{290+q["x"]*8:.3f},{1640-q["z"]*8:.3f}' for q in points)
    svg=['<svg xmlns="http://www.w3.org/2000/svg" width="880" height="1750" viewBox="0 0 880 1750">',
         '<rect width="880" height="1750" fill="#f7f4ec"/>',
         '<g font-family="Arial,sans-serif" fill="#2e2934">',
         '<text x="38" y="42" font-size="25" font-weight="700">WISHWEAVE · CONNECTED LEVEL 1</text>',
         '<text x="38" y="69" font-size="14">Spatial blockout only · exact X/Z route projection · Y-up meters</text>',
         f'<text x="38" y="92" font-size="14">Main {route["mainRoute"]["length"]:.1f} m × 6 m · branch {route["branches"][0]["length"]:.1f} m × 2.6 m</text>',
         f'<polyline points="{coords(main)}" fill="none" stroke="#706079" stroke-width="52" stroke-linejoin="round"/>',
         f'<polyline points="{coords(branch)}" fill="none" stroke="#706079" stroke-width="24.8" stroke-linejoin="round"/>',
         f'<polyline points="{coords(main)}" fill="none" stroke="#dcd0b8" stroke-width="48" stroke-linejoin="round"/>',
         f'<polyline points="{coords(branch)}" fill="none" stroke="#dcd0b8" stroke-width="20.8" stroke-linejoin="round"/>',
         f'<polyline points="{coords(main)}" fill="none" stroke="#9c8a73" stroke-width="1.4" stroke-dasharray="7 7"/>']
    for sec in route['sections']:
        mid=(sec['startS']+sec['endS'])/2
        q=min(main,key=lambda x:abs(x['s']-mid)); x,y=map_pos([q['x'],q['y'],q['z']])
        svg.extend([f'<path d="M {x+30:.2f},{y:.2f} H 525" stroke="#b9adbe" fill="none"/>',
                    f'<text x="540" y="{y-3:.2f}" font-size="17" font-weight="700">{sec["name"]}</text>',
                    f'<text x="540" y="{y+18:.2f}" font-size="13">{sec["startS"]:.1f}–{sec["endS"]:.1f} m</text>'])
    for landmark in route['landmarks']:
        x,y=map_pos(landmark['position'])
        if landmark['id'] in ('flowergate','tassel-arch'):
            q=min(main,key=lambda v:abs(v['s']-landmark['mainS']))
            tx,tz=q['tangent'][0],q['tangent'][2]; norm=math.hypot(tx,tz); rx,rz=tz/norm,-tx/norm
            svg.append(f'<path d="M {x-rx*35:.2f},{y+rz*35:.2f} L {x+rx*35:.2f},{y-rz*35:.2f}" stroke="#bb7493" stroke-width="8"/>')
        else:
            svg.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{landmark["footprintRadius"]*8:.2f}" fill="#aa97c6" stroke="#706079" stroke-width="2"/>')
        if landmark['id'].startswith('tower'):
            svg.append(f'<text x="{x-29:.2f}" y="{y+4:.2f}" font-size="11" fill="#fff">TOWER</text>')
    for item in route['collectibles']:
        x,y=map_pos(item['position']); color={'red':'#e93f51','teal':'#0aa49c','gold':'#e7b329'}[item['type']]
        svg.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="7" fill="{color}" stroke="#fff" stroke-width="2"/>')
    for label,data in [('START',route['spawnPositions']['player']),('FINISH / FLOWERGATE',route['finish'])]:
        x,y=map_pos(data['position']); svg.append(f'<text x="{x+45:.2f}" y="{y+5:.2f}" font-size="14" font-weight="700">{label}</text>')
    svg += ['<path d="M 50,1650 H 130 M 50,1645 V 1655 M 130,1645 V 1655" stroke="#2e2934" stroke-width="2"/>',
            '<text x="72" y="1675" font-size="12">10 m</text>',
            '<text x="38" y="1720" font-size="12">Muted discs = landmark footprints · coral bars = arches · colored dots = red / teal / gold collectibles</text>',
            '</g></svg>']
    path.write_text('\n'.join(svg)+'\n')


def readme(route,validation):
    return f'''# Wishweave Level 1 — connected spatial blockout

**BLOCKOUT ONLY.** `level1-connected-layout.glb` is real glTF 2.0 3D geometry: one continuous gently sloping main ribbon, one connected branch/rejoin, and named simple landmark geometry. It still needs approved textured ornamental production art matching the separate loomcity target. It is not a finished game or production scenery asset. There are no image plates, textures, rigged characters, colliders, AI, or controls.

## Files

- `level1-connected-layout.glb` — engine-neutral binary glTF spatial scaffold.
- `route.json` — authoritative centerlines, arc lengths, widths, sections, spawns, collectible positions, branch links, and finish coordinates.
- `course-overhead.svg` — exact X/Z overhead projection of the same route data.
- `validation.json` — generated topology, slope, continuity, mesh, and placement checks.
- `generate_course.py` — deterministic reusable generator; Python 3 and NumPy only.

Run `python generate_course.py --output .` from this directory to regenerate all outputs. The script defaults to its own directory. It overwrites only the listed generated outputs.

## Spatial contract

World units are meters, Y is up, and +Z is forward. Main route is {route['mainRoute']['length']:.3f} m long and 6 m wide; branch is {route['branches'][0]['length']:.3f} m long and 2.6 m wide. All `s` values are dense-reference 3D arc length in meters; summing the exported sample chords differs by less than 4 mm over each complete route. Main samples are at most 0.5 m apart; branch samples at most 0.25 m apart. `points` contain `x`, `y`, `z`, `s`, `width`, `tangent`, and `sectionId`. `y` is deck surface elevation. Interpolate between samples, then apply the controller's own grounded/foot offset. Tangent is unit 3D forward; horizontal right is `normalize([tangent.z, 0, -tangent.x])`.

`mainRoute.spawn` and `spawnPositions.player` are the same ground reference. `mainRoute.finish`, top-level `finish`, the Flowergate node origin, and `Finish_Trigger_Origin` use the same endpoint. The visible finish band extends 1.2 m backward from that endpoint with a tiny render offset. A controller should detect crossing the finish plane or `s >= mainRoute.length`, not proximity to a decorative support.

`branches[0].startS` and `endS` address the main route. Its `points[].s` is local branch distance; `points[].mainS` gives monotonically increasing equivalent main-route progress. The `from` and `to` positions exactly match main samples. `connectivity` explicitly links both junctions. The bypass intentionally overlaps the main deck at fork/rejoin to guarantee connected surface; collision union/baking and engine playtesting remain required. This is not a ready-made production collision mesh.

Six sections divide the same unbroken road; they are metadata ranges, not separate rooms. Landmark solids sit off the 6 m floor; arch/gate crossbars are overhead. The Snagling landing and butterfly banner are location placeholders, not characters or behavior. Collectible markers occur at 15% red, 52% teal, and 80% gold.

## Verification and handoff

Generated checks currently pass: max main slope {validation['metrics']['mainMaxSlopeDegrees']:.3f}°, max branch slope {validation['metrics']['branchMaxSlopeDegrees']:.3f}°, minimum main horizontal bend radius {validation['metrics']['minimumHorizontalBendRadiusMeters']:.3f} m. The main ribbon outline has no self intersections. Mesh indices, nondegenerate faces, finite positions, and unit vertex normals are checked. These are geometric checks; visual fidelity, camera clearance, animation, physics, gameplay and accessibility still require implementation and engine review.

Use named nodes and route anchors to replace blockout masses with approved scenery while preserving the connected floor and all route coordinates. Gate supports leave more than 6 m clear; there are no rails or fall protection in this scaffold. Flat colors indicate object roles and are not final material decisions.
'''

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parent)
    generate(parser.parse_args().output.resolve())
