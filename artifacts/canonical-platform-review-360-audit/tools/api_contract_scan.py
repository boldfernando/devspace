#!/usr/bin/env python3
"""Find common API contract files without changing the repository."""
import json, sys
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
patterns=('openapi','swagger','asyncapi','schema.graphql','graphql','schema.json')
found=[]
for p in root.rglob('*'):
    if any(part in {'.git','node_modules','.next','dist','build'} for part in p.parts): continue
    if p.is_file() and any(x in p.name.lower() for x in patterns): found.append(str(p.relative_to(root)))
print(json.dumps({'root':str(root),'contracts':sorted(found)},indent=2))
