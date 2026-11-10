from probe import Client, BASE, SVEN_ARGS, error_label
from recheck import brief, decode
import concurrent.futures as cf
from pathlib import Path
import json, tempfile

def knowledge():
    with tempfile.TemporaryDirectory(dir=BASE,prefix="ok-test-") as folder:
        root=Path(folder)
        (root/".ok").mkdir()
        (root/".ok/config.yml").write_text("content:\n  dir: .\n")
        (root/"Probe.md").write_text("---\ntitle: Sven MCP Smoke\n---\n\nDisposableOpenKnowledgeProbeToken\n")
        client=Client(SVEN_ARGS,folder)
        try:
            thread=client.call("thread/start",{"cwd":folder,"ephemeral":True,"model":"gpt-5.6-sol","modelProvider":"openai","approvalPolicy":"on-request","sandbox":"read-only"},20)["thread"]["id"]
            def mcp(name,args):
                try:
                    res=client.call("mcpServer/tool/call",{"threadId":thread,"server":"open-knowledge","tool":name,"arguments":args},36)
                    summary=brief("open-knowledge",name,res)
                    value=decode(res)
                    if not res.get("isError") and name=="config":
                        summary["expectedContentRoot"]=value=="." or (isinstance(value,dict) and value.get("value")==".") or str(value).strip()=="." or str(value).strip()=='"."'
                    if name=="search" and not res.get("isError"):
                        summary["foundSyntheticDocument"]="Probe.md" in json.dumps(value)
                    print(json.dumps(summary,ensure_ascii=False),flush=True)
                except Exception as e:
                    print(json.dumps({"server":"open-knowledge","tool":name,"failure":error_label(e)}),flush=True)
            mcp("config",{"cwd":folder,"key":"content.dir"})
            mcp("search",{"cwd":folder,"query":"DisposableOpenKnowledgeProbeToken","limit":1,"semantic":False})
        finally: client.close()

def app_flag():
    with tempfile.TemporaryDirectory(dir=BASE,prefix="app-test-") as folder:
        client=Client(SVEN_ARGS + ["-c","features.apps=true"],folder)
        try:
            account=(client.call("account/read",{"refreshToken":False},14).get("account") or {})
            a=client.pages("app/list",{"limit":100,"forceRefetch":True})
            print(json.dumps({"appDiagnosticOnly":True,"catalogSize":len(a),"accessible":[{"id":v["id"],"name":v["name"]} for v in a if v.get("isAccessible")], "accountType":account.get("type")}),flush=True)
        except Exception as e: print(json.dumps({"appFlagFailure":error_label(e)}),flush=True)
        finally: client.close()

with cf.ThreadPoolExecutor(2) as pool:
    fs=[pool.submit(knowledge),pool.submit(app_flag)]
    for f in cf.as_completed(fs): f.result()
