#!/usr/bin/env python3
"""Package the complete visual handoff after build-deliverables.py and checks."""
from pathlib import Path
import hashlib
import json
import shutil
import zipfile

root = Path(__file__).resolve().parents[1]
parent = root.parent
prompt = parent / 'CLAUDIA-LEVEL1-COMPLETE-PROMPT.txt'
shutil.copy2(root / 'CLAUDIA-PROMPT.txt', prompt)
extras = [parent / name for name in [
    'Preview-Wishweave-Level1-Complete-Small.html',
    'Wishweave-Level1-Complete-For-Claude.html',
    'CLAUDIA-COMPLETE-SOURCE.txt',
    'CLAUDIA-LEVEL1-COMPLETE-PROMPT.txt',
]]
for p in extras:
    if not p.is_file(): raise SystemExit('Missing export: '+str(p))
assert extras[0].stat().st_size < 5_000_000
assert extras[1].stat().st_size < 100_000
approved = json.loads((root/'docs/APPROVED-ART-HASHES.json').read_text())
for name, expected in approved.items():
    assert hashlib.sha256((root/'approved'/name).read_bytes()).hexdigest() == expected, name
for report in ['tests/browser-checks.json','tests/export-checks.json']:
    assert json.loads((root/report).read_text())['passed'], report
def include(p):
    rel = p.relative_to(root)
    return p.is_file() and not any(x in {'captures','__pycache__','node_modules','.gradle','build'} for x in rel.parts) and rel.name != 'SHA256SUMS.txt'
files = sorted(p for p in root.rglob('*') if include(p))
checksums=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(root).as_posix()+'\n' for p in files)
(root/'SHA256SUMS.txt').write_text(checksums)
files.append(root/'SHA256SUMS.txt')
archive=parent/'Wishweave-Level1-Complete-Visual-Kit.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in files: z.write(p, root.name+'/'+p.relative_to(root).as_posix())
    for p in extras: z.write(p,p.name)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for name,expected in approved.items():
        assert hashlib.sha256(z.read(root.name+'/approved/'+name)).hexdigest()==expected
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'entries':len(files)+len(extras),'approvedOriginalsPreserved':True,'crcVerified':True,'exports':[{'name':p.name,'bytes':p.stat().st_size} for p in extras]},indent=2))
