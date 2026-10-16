#!/usr/bin/env python3
"""Create independent small ZIP parts. Extract all into the same parent folder."""
import hashlib
import json
import zlib
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent
CAP = 4_850_000
files = sorted(p for p in ROOT.rglob('*') if p.is_file()
               and '__pycache__' not in p.parts
               and p.name not in {'SHA256SUMS.txt', 'PACKAGE-CONTENTS.json'})
assert all(p.stat().st_size for p in files), 'Empty source file found'

def cost(p):
    return len(zlib.compress(p.read_bytes(), 9)) + 200 + 2 * len(str(p.relative_to(ROOT)))

core = [p for p in files if p.relative_to(ROOT).parts[0] not in {'art','references'}
        or (p.relative_to(ROOT).parts[0] == 'references' and p.name in {
            '01-opening-target.webp','02-connected-turn-target.webp','03-finish-target.webp','manifest.json'})]
bins = [core]
weights = [sum(map(cost, core)) + 80_000]
assert weights[0] < CAP
for p in sorted(set(files) - set(core), key=cost, reverse=True):
    size = cost(p)
    for i, weight in enumerate(weights):
        if weight + size <= CAP:
            bins[i].append(p); weights[i] += size
            break
    else:
        assert size < CAP, f'File too large: {p}'
        bins.append([p]); weights.append(size)

names = [f'Wishweave-Connected-Part-{i+1:02d}-of-{len(bins):02d}.zip' for i in range(len(bins))]
manifest = {
    'instructions': 'These are independent ZIPs, not binary split volumes. Extract ALL into the same parent folder. Open Wishweave-Connected-World-Kit/index.html. Send all parts and CLAUDIA-PROMPT.txt together.',
    'maximum_package_bytes': 5_000_000,
    'parts': [{'name': name, 'files': sorted(str(p.relative_to(ROOT)) for p in group)} for name,group in zip(names,bins)]
}
manifest['parts'][0]['files'] += ['PACKAGE-CONTENTS.json','SHA256SUMS.txt']
inventory = ROOT/'PACKAGE-CONTENTS.json'
inventory.write_text(json.dumps(manifest,indent=2)+'\n')
checksums = ROOT/'SHA256SUMS.txt'
checksums.write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(ROOT)}\n' for p in sorted(files+[inventory])))
bins[0] += [inventory,checksums]

results=[]; names_seen=[]
for name,group in zip(names,bins):
    destination=OUT/name
    with zipfile.ZipFile(destination,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for p in sorted(group):
            arc=f'{ROOT.name}/{p.relative_to(ROOT)}'
            info=zipfile.ZipInfo(arc,date_time=(2026,10,16,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(info,p.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
    assert destination.stat().st_size < 5_000_000, f'Package exceeds cap: {name}'
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
        for info in archive.infolist():
            expected=ROOT/Path(info.filename).relative_to(ROOT.name)
            assert archive.read(info)==expected.read_bytes(), info.filename
            names_seen.append(info.filename)
    results.append({'file':str(destination),'bytes':destination.stat().st_size,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest(),'files':len(group)})
assert len(names_seen)==len(set(names_seen))==len(files)+2
print(json.dumps(results,indent=2))
