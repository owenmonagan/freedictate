"""Accuracy and latency check for the local speech engine.
Synthesizes dictation-style sentences with macOS voices, posts them to whisper-server
exactly as app/dictate.lua does, and reports word error rate and latency.
Usage: python3 tools/bench.py "$(mktemp -d)"   (whisper-server must be running)"""
import subprocess,time,re,json,sys,os
D=sys.argv[1]
S=["Can we move Thursday's design review to three in the afternoon?",
"I pushed the fix to main, so the build should pass now.",
"Please send me the quarterly numbers before the board meeting on Friday.",
"Let's refactor the authentication middleware and add tests for the edge cases.",
"Remind me to call the dentist tomorrow morning at nine thirty.",
"The new onboarding flow cut setup time roughly in half.",
"Open the pull request, review the diff, and leave comments on anything unclear.",
"Thanks for the quick turnaround, this looks great.",
"We should cache the API responses for at least five minutes.",
"Write a short summary of this meeting and share it with the team."]
V=["Samantha","Daniel","Karen","Moira"]
def norm(t):
    t=t.lower().replace("9.30","nine thirty").replace("9:30","nine thirty").replace(" 5 "," five ").replace(" 3 "," three ")
    return re.sub(r"[^a-z' ]"," ",t).split()
def wer(r,h):
    d=list(range(len(h)+1))
    for i,a in enumerate(r,1):
        p=d[:];d[0]=i
        for j,b in enumerate(h,1): d[j]=min(p[j]+1,d[j-1]+1,p[j-1]+(a!=b))
    return d[len(h)],len(r)
E_=N=0;lat=[];fails=[]
for v in V:
  for i,s in enumerate(S):
    a=f"{D}/{v}{i}.aiff";w=f"{D}/{v}{i}.wav"
    subprocess.run(["say","-v",v,"-o",a,s],check=True)
    subprocess.run(["ffmpeg","-loglevel","error","-y","-i",a,"-ar","16000","-ac","1",w],check=True)
    t=time.time()
    out=subprocess.run(["curl","-s","--fail","127.0.0.1:8178/inference","-F",f"file=@{w}","-F","response_format=text","-F","temperature=0"],capture_output=True,text=True).stdout.strip()
    lat.append(time.time()-t)
    e,n=wer(norm(s),norm(out));E_+=e;N+=n
    if e: fails.append((v,s,out))
lat.sort()
print(json.dumps({"clips":len(lat),"wer_pct":round(100*E_/N,2),"latency_median_s":round(lat[len(lat)//2],2),"latency_p90_s":round(lat[int(len(lat)*.9)],2),"latency_max_s":round(lat[-1],2)}))
for f in fails: print("MISS",f)
