from probe import Client, BASE, SVEN_ARGS, error_label
from recheck import decode, brief_error
from pathlib import Path
import json, tempfile, time
with tempfile.TemporaryDirectory(dir=BASE,prefix="ok-index-test-") as folder:
    root=Path(folder)
    (root/".ok").mkdir()
    (root/".ok/config.yml").write_text("content:\n  dir: .\n")
    (root/"Probe.md").write_text("---\ntitle: Sven MCP Smoke\n---\n\nDisposableOpenKnowledgeProbeToken\n")
    client=Client(SVEN_ARGS,folder)
    try:
        thread=client.call("thread/start",{"cwd":folder,"ephemeral":True,"model":"gpt-5.6-sol","modelProvider":"openai","approvalPolicy":"on-request","sandbox":"read-only"},20)["thread"]["id"]
        for q in ["Sven MCP Smoke","Probe","DisposableOpenKnowledgeProbeToken"]:
            try:
                res=client.call("mcpServer/tool/call",{"threadId":thread,"server":"open-knowledge","tool":"search","arguments":{"cwd":folder,"query":q,"limit":2,"semantic":False}},20)
                x=decode(res)
                if isinstance(x,dict):
                    items=x.get("results")
                    found=isinstance(items,list) and any("Probe" in json.dumps(item) for item in items)
                    report={"query":q,"ready":x.get("ready"),"count":x.get("resultCount"),"foundTestFile":found,"toolError":bool(res.get("isError"))}
                    if not found:report["message"]=brief_error(x.get("text",""))
                    print(json.dumps(report),flush=True)
                    if found:break
                else:
                    print(json.dumps({"query":q,"toolError":bool(res.get("isError")),"message":brief_error(x)}),flush=True)
            except Exception as e: print(json.dumps({"query":q,"failure":error_label(e)}),flush=True)
            time.sleep(3)
    finally:client.close()
