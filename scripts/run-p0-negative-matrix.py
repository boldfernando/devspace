from __future__ import annotations
import argparse, json, os, re, shlex, subprocess, sys, time
from pathlib import Path
REQUIRED = ["OAUTH-NEG-%03d" % i for i in range(1,9)] + ["BEARER-NEG-%03d" % i for i in range(1,5)] + ["SESSION-NEG-%03d" % i for i in range(1,5)] + ["MCP-NEG-%03d" % i for i in range(1,6)] + ["RELEASE-NEG-001", "RELEASE-NEG-002"]
SECRETS = [re.compile(r"(?i)bearer\s+[A-Za-z0-9._~-]+"), re.compile(r"(?i)owner[_-]?token\s*[=:]\s*[^\s,;]+"), re.compile(r"(?i)access[_-]?token\s*[=:]\s*[^\s,;]+"), re.compile(r"(?i)code[_-]?verifier\s*[=:]\s*[^\s,;]+") ]
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--repo",type=Path,default=Path.cwd())
    p.add_argument("--command",default="node --test scripts/e2e-http-mcp-negative.test.mjs")
    p.add_argument("--report-json",type=Path,default=Path("artifacts/oauth-mcp-negative-report.json"))
    p.add_argument("--summary-md",type=Path,default=Path("artifacts/e2e-security-summary.md"))
    p.add_argument("--allow-missing-scenarios",action="store_true")
    a=p.parse_args(); repo=a.repo.resolve(); env=os.environ.copy(); env.update(CI="true", DEVSPACE_ENV="staging", DEVSPACE_TEST_MODE="true", E2E_NEGATIVE_MATRIX="true")
    started=time.time(); cmd=shlex.split(a.command)
    try: r=subprocess.run(cmd,cwd=repo,env=env,text=True,capture_output=True,check=False); output=(r.stdout or "")+"\n"+(r.stderr or "") ; code=r.returncode
    except OSError as e: output="executor_error: "+str(e); code=127
    missing=[x for x in REQUIRED if x not in output]; leak=any(x.search(output) for x in SECRETS); status="passed" if code==0 and not missing and not leak else "failed"
    payload={"started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"duration_ms":round((time.time()-started)*1000),"command":cmd,"exit_code":code,"required_scenarios":REQUIRED,"observed_scenarios":[x for x in REQUIRED if x in output],"missing_scenarios":missing,"secret_leak_detected":leak,"status":status,"sanitized_output":output}
    payload["sanitized_output"] = re.sub(r"(?i)(bearer\s+|owner[_-]?token\s*[=:]\s*|access[_-]?token\s*[=:]\s*|code[_-]?verifier\s*[=:]\s*)[^\s,;]+", r"\\1[REDACTED]", output)
    report=repo/a.report_json if not a.report_json.is_absolute() else a.report_json; summary=repo/a.summary_md if not a.summary_md.is_absolute() else a.summary_md; report.parent.mkdir(parents=True,exist_ok=True); summary.parent.mkdir(parents=True,exist_ok=True)
    report.write_text(json.dumps(payload,indent=2,ensure_ascii=False)+"\n",encoding="utf-8"); summary.write_text("# OAuth/MCP P0 negative matrix\n\n- Status: **"+status+"**\n- Scenarios: **"+str(len(REQUIRED)-len(missing))+"/"+str(len(REQUIRED))+"**\n- Secret leak: **"+str(leak)+"**\n- Missing: `"+", ".join(missing)+"`\n",encoding="utf-8"); print(json.dumps(payload,ensure_ascii=False)); return 0 if status=="passed" or (a.allow_missing_scenarios and code==0 and not leak) else 1
if __name__ == "__main__": sys.exit(main())
