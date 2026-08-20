#!/usr/bin/env python3
"""Capture read-only Git baseline as JSON."""
import json, subprocess, sys
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
def git(*args):
    p=subprocess.run(['git','-C',str(root),*args],text=True,capture_output=True)
    return {'ok':p.returncode==0,'stdout':p.stdout.strip(),'stderr':p.stderr.strip()}
out={'root':str(root),'head':git('rev-parse','HEAD'),'branch':git('branch','--show-current'),'status':git('status','--short','--branch'),'remotes':git('remote','-v'),'worktrees':git('worktree','list','--porcelain')}
print(json.dumps(out,indent=2))
