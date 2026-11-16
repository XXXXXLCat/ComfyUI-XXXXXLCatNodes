import json, sys, os, re, glob

assets = sys.argv[1]
pat = re.compile(sys.argv[2], re.I)
out = sys.argv[3] if len(sys.argv) > 3 else None
if out:
    os.makedirs(out, exist_ok=True)

for path in glob.glob(os.path.join(assets, "*.js.map")):
    try:
        m = json.load(open(path, encoding="utf-8"))
    except Exception:
        continue
    sources = m.get("sources") or []
    contents = m.get("sourcesContent") or []
    for i, s in enumerate(sources):
        if not pat.search(s):
            continue
        c = contents[i] if i < len(contents) else None
        print(os.path.basename(path), "|", s, "|", len(c or ""))
        if out and c:
            name = os.path.basename(s)
            open(os.path.join(out, name), "w", encoding="utf-8").write(c)
