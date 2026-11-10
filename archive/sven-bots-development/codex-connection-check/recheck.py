from probe import Client, BASE, SVEN_ARGS, error_label
import concurrent.futures as cf
from pathlib import Path
import json, re, tempfile
def decode(r):
    if r.get("structuredContent") is not None: return r["structuredContent"]
    a=[c.get("text","") for c in r.get("content",[]) if c.get("type")=="text"]
    if len(a)==1:
        try: return json.loads(a[0])
        except ValueError: return a[0]
    return a
def brief_error(x):
    if isinstance(x,dict):
        if isinstance(x.get("error"),dict): x=x["error"]
        elif x.get("error"): x=x["error"]
        if isinstance(x,dict):
            x=next((x[k] for k in ("message","detail","reason","code") if isinstance(x.get(k),str)), "")
    if not isinstance(x,str): return ""
    x=re.sub(r"https?://[^\s,;\]\)}]+","[URL]",x)
    x=re.sub(r"/Users/[^\s,;\]\)}]+","[local path]",x)
    x=re.sub(r"(?:[A-Za-z0-9_/-]{30,}|[^\s@]+@[^\s@]+)", "[redacted]",x)
    return x.strip()[:240]
def brief(server, tool, response):
    x=decode(response)
    bad=bool(response.get("isError")) or isinstance(x,dict) and (x.get("ok") is False or bool(x.get("error")))
    result={"server":server,"tool":tool,"ok":not bad,"format":type(x).__name__}
    if bad:
        result["reason"]=brief_error(x)
    elif server=="node_repl": result["verified42"]=x==42 or str(x).strip()=="42"
    elif server=="china-check-public":
        result["fields"]=list(x) if isinstance(x,dict) else []
        if isinstance(x,dict):
            result["collections"]={k:len(v) for k,v in x.items() if isinstance(v,list)}
            for k in ("count","total","total_results"):
                if isinstance(x.get(k),int):result[k]=x[k]
        elif isinstance(x,str):
            result["nonempty"]=bool(x)
            result["matchedPublicCompany"]="腾讯" in x or "tencent" in x.lower()
    elif server=="ghidra-mcp" and isinstance(x,dict):
        result["instances"]=len(x.get("instances",[]))
    elif server in ("rea","open-knowledge"):
        result["fields"]=list(x)[:16] if isinstance(x,dict) else []
        if isinstance(x,dict):
            result["hasValue"]="value" in x and x["value"] is not None
    return result

def run():
    with tempfile.TemporaryDirectory(dir=BASE,prefix="repeat-session-") as folder:
        p=Path(folder)
        (p/"probe.js").write_text("export const smoke = 42;\n")
        (p/"probe.wasm").write_bytes(bytes([0,97,115,109,1,0,0,0]))
        (p/".ok").mkdir()
        client=Client(SVEN_ARGS,folder)
        try:
            thread=client.call("thread/start",{"cwd":folder,"ephemeral":True,"model":"gpt-5.6-sol","modelProvider":"openai","approvalPolicy":"on-request","sandbox":"read-only"},25)["thread"]["id"]
            def call(server,tool,args):
                try:
                    r=client.call("mcpServer/tool/call",{"threadId":thread,"server":server,"tool":tool,"arguments":args},42)
                    print(json.dumps(brief(server,tool,r),ensure_ascii=False),flush=True)
                    return not r.get("isError") and not (isinstance(decode(r),dict) and bool(decode(r).get("error")))
                except Exception as e:
                    print(json.dumps({"server":server,"tool":tool,"failure":error_label(e)}),flush=True)
                    return False
            def apps():
                try:
                    a=client.pages("app/list",{"threadId":thread,"limit":100,"forceRefetch":True})
                    print(json.dumps({"svenThreadApps":len(a),"accessible":[v["name"] for v in a if v.get("isAccessible")]}),flush=True)
                except Exception as e:
                    print(json.dumps({"svenThreadAppsError":error_label(e)}),flush=True)
            def rea():
                call("rea","inspect_wasm_artifact",{"path":str(p/"probe.wasm"),"detail":"summary"})
                if call("rea","open_binary",{"path":str(p/"probe.js")}):
                    call("rea","binary_session",{})
            with cf.ThreadPoolExecutor(7) as pool:
                futures=[
                    pool.submit(apps),pool.submit(rea),
                    pool.submit(call,"china-check-public","search_chinese_company",{"query":"腾讯科技（深圳）有限公司","language":"en"}),
                    pool.submit(call,"open-knowledge","config",{"cwd":folder,"key":"appearance.theme"}),
                    pool.submit(call,"ghidra-mcp","list_tool_groups",{}),
                    pool.submit(call,"node_repl","js",{"code":"console.log(6 * 7)","title":"本地算术健康检查","timeout_ms":5000}),
                ]
                for f in cf.as_completed(futures):f.result()
        finally: client.close()
if __name__=="__main__": run()
