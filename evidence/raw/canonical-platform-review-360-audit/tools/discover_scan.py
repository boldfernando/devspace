#!/usr/bin/env python3
"""Emit a lightweight repository manifest without modifying the repo."""
import json, os, sys
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
markers=['package.json','pnpm-lock.yaml','yarn.lock','package-lock.json','pyproject.toml','requirements.txt','go.mod','Cargo.toml','Dockerfile','docker-compose.yml','compose.yaml']
found=[]
for p in root.rglob('*'):
    if any(part in {'.git','node_modules','.next','dist','build','.venv','venv'} for part in p.parts): continue
    if p.is_file() and p.name in markers: found.append(str(p.relative_to(root)))
print(json.dumps({'root':str(root),'markers':sorted(found)},indent=2))
