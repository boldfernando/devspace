#!/usr/bin/env python3
from pathlib import Path
import argparse, json, re, os

def parse_name(p):
    try: text=p.read_text(encoding='utf-8')
    except Exception: return None
    m=re.match(r'^---\n(.*?)\n---\n',text,re.S)
    if not m: return None
    n=re.search(r'^name:\s*["\']?([^"\'\n]+)',m.group(1),re.M)
    return n.group(1).strip() if n else None

def scan(root,scope):
    out=[]
    if root.exists():
        for d in sorted(root.iterdir()):
            p=d/'SKILL.md'
            if d.is_dir() and p.exists(): out.append({'scope':scope,'path':str(d),'name':parse_name(p) or d.name,'openai_yaml':str(d/'agents'/'openai.yaml') if (d/'agents'/'openai.yaml').exists() else None})
    return out

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--repo',default='.')
    ap.add_argument('--include-user',action='store_true')
    ap.add_argument('--custom',action='append',default=[])
    args=ap.parse_args()
    repo=Path(args.repo).expanduser().resolve()
    roots=[]
    cur=repo
    git_root=None
    for p in [cur,*cur.parents]:
        if (p/'.git').exists(): git_root=p; break
    stop=git_root or repo
    p=repo
    while True:
        roots.append((p/'.agents'/'skills',f'repo:{p}'))
        if p==stop or p.parent==p: break
        p=p.parent
    if args.include_user: roots.append((Path.home()/'.agents'/'skills','user'))
    for c in args.custom: roots.append((Path(c).expanduser().resolve(),'custom'))
    found=[]
    for r,s in roots: found.extend(scan(r,s))
    by={}
    for x in found: by.setdefault(x['name'],[]).append(x)
    collisions={k:v for k,v in by.items() if len(v)>1}
    print(json.dumps({'repository':str(repo),'git_root':str(git_root) if git_root else None,'roots':[{'scope':s,'path':str(r)} for r,s in roots],'skills':found,'collisions':collisions},indent=2))
if __name__=='__main__': main()
