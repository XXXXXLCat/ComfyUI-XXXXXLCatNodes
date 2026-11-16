import json,sys,os,re
p=sys.argv[1]; out=sys.argv[2]; pat=sys.argv[3] if len(sys.argv)>3 else None
m=json.load(open(p,encoding='utf-8'))
os.makedirs(out,exist_ok=True)
n=0
for s,c in zip(m.get('sources',[]),m.get('sourcesContent') or []):
    if c is None: continue
    if pat and not re.search(pat,s,re.I): continue
    name=s.split('/')[-1]
    open(os.path.join(out,name),'w',encoding='utf-8').write(c)
    n+=1
    print(name, len(c))
print('total',n)
