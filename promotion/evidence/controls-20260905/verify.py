"""Verify the retained packet's raw bytes; optionally compare its historical source binding."""
import argparse, hashlib, json, stat
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-root', type=Path, help='Optional checkout with the exact reviewed177 source files')
args = parser.parse_args()
root = Path(__file__).resolve().parent

def safe_file(base, name):
    relative = Path(name)
    if relative.is_absolute() or relative.drive or '..' in relative.parts:
        raise ValueError('Non-relative payload path: ' + name)
    current = base
    for part in relative.parts:
        current = current / part
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 1024:
            raise ValueError('Linked payload path: ' + name)
    if not current.is_file():
        raise ValueError('Missing regular file: ' + name)
    return current

def verify(base, rows):
    for row in rows:
        raw = safe_file(base, row['path']).read_bytes()
        assert len(raw) == row['bytes'], row['path']
        assert hashlib.sha256(raw).hexdigest() == row['sha256'], row['path']
        if 'rawGitBlobSha1' in row:
            assert hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest() == row['rawGitBlobSha1'], row['path']
    return len(rows)

manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
count = verify(root, manifest['files'])
source_count = None
if args.source_root:
    bindings = json.loads((root / 'raw/E6j-nodevoice-ui-final-freeze-01/current-source-dist.json').read_text(encoding='utf-8'))
    source_count = verify(args.source_root.resolve(strict=True), bindings['source'])
print(json.dumps({'packet': 'PASS', 'payloads': count, 'sourceFilesVerified': source_count,
                  'limit': 'Raw byte/hash preservation only; no browser replay, provenance authentication, staged/filter equality, deployment or full readiness certification.'}))
