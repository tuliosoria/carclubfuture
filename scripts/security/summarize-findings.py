"""Emit only rule IDs and file paths, never matches, snippets, credentials or messages."""
import json,pathlib,re,sys
root=pathlib.Path(sys.argv[1])
seen=set()
credential_metadata=re.compile(r"-----BEGIN[^\n]*PRIVATE KEY|(?:AKIA|ASIA)[A-Z0-9]{16}|github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]{20,}|sk[-_](?:live_|test_|proj-)?[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:password|secret|token|api[_-]?key)\s*[=:]\s*[^/\s]+|Bearer\s+[A-Za-z0-9._-]+",re.I)
def safe_metadata(value,limit):
    return '[REDACTED_METADATA]' if credential_metadata.search(value) else value[:limit]

for name in ('gitleaks-history.json','gitleaks-tree.json','gitleaks-bundle.json','gitleaks-critical.json','semgrep.json'):
    p=root/name
    if not p.is_file():continue
    try: payload=json.loads(p.read_text())
    except (ValueError,OSError):continue
    entries=payload if isinstance(payload,list) else payload.get('results',[]) if isinstance(payload,dict) else []
    for item in entries:
        if not isinstance(item,dict):continue
        rule=item.get('RuleID',item.get('check_id'))
        path=item.get('File',item.get('path'))
        if not isinstance(rule,str) or not isinstance(path,str):continue
        # Bound attacker-controlled metadata and JSON-escape control characters.
        key=(safe_metadata(rule,240),safe_metadata(path,500))
        if key in seen:continue
        seen.add(key)
        if len(seen)>50:break
        print('Finding location: '+json.dumps({'rule':key[0],'path':key[1]},ensure_ascii=True))
    if len(seen)>50:
        print('Further locations omitted; reproduce locally for private triage')
        break
