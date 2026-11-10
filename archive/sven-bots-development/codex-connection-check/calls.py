from probe import Client, BASE, SVEN_ARGS, error_label
from pathlib import Path
import concurrent.futures as cf
import json, re, tempfile

def extract(reply):
    if reply.get("structuredContent") is not None:
        return reply["structuredContent"]
    parts=[part.get("text","") for part in reply.get("content",[]) if part.get("type")=="text"]
    if len(parts)==1:
        try: return json.loads(parts[0])
        except ValueError: return parts[0]
    return parts

def summarize(server, tool, reply):
    payload=extract(reply)
    error=bool(reply.get("isError")) or (isinstance(payload,dict) and (payload.get("ok") is False or bool(payload.get("error"))))
    keys=list(payload) if isinstance(payload,dict) else []
    r={"server":server,"tool":tool,"mcpError":error,"format":type(payload).__name__,"fields":keys[:25]}
    if isinstance(payload,dict):
        for key in ("status","state","ready","ok","success","mode","result_count","count","total","complete"):
            val=payload.get(key)
            if isinstance(val,(bool,int)) or isinstance(val,str) and re.fullmatch(r"[a-zA-Z_ -]{1,32}",val):
                r[key]=val
        r["collectionSizes"]={k:len(v) for k,v in payload.items() if isinstance(v,(list,dict)) and k not in ("settings", "config") and re.fullmatch(r"[a-zA-Z_]{1,32}",k)}
        if server=="browser-fast-hybrid":
            for key in ("blockers","warnings"):
                if isinstance(payload.get(key),list):
                    r[key]=[str(v)[:160] for v in payload[key] if isinstance(v,str)]
        if server=="open-knowledge":
            r["valueReturned"]="value" in payload and payload["value"] is not None
    if isinstance(payload,list): r["items"]=len(payload)
    if isinstance(payload,str):
        r["chars"]=len(payload)
        if server=="node_repl": r["arithmetic"]=bool(re.search(r"\b42\b",payload))
        if server=="openaiDeveloperDocs": r["hasOfficialResults"]="developers.openai.com" in payload or "platform.openai.com" in payload
    if error:
        raw=payload if isinstance(payload,str) else payload.get("message",payload.get("error","")) if isinstance(payload,dict) else ""
        if isinstance(raw,str):
            labels={"missing runtime/target": ("not installed","not found","no active","not set","unavailable","enoent","no such"), "not connected": ("connection","refused","failed to connect","timeout"), "authentication": ("unauthenticated","unauthorized","oauth","token","401","403"), "request invalid": ("invalid","required","argument"), "not supported": ("unsupported","not supported")}
            r["errorCategory"]=next((tag for tag,terms in labels.items() if any(term in raw.lower() for term in terms)),"tool reported error")
    return r

with tempfile.TemporaryDirectory(dir=BASE,prefix="call-session-") as folder:
    artifact=Path(folder)/"probe.wasm"
    artifact.write_bytes(bytes([0,97,115,109,1,0,0,0]))
    client=Client(SVEN_ARGS,folder)
    try:
        thread=client.call("thread/start",{"cwd":folder,"ephemeral":True,"model":"gpt-5.6-sol","modelProvider":"openai","approvalPolicy":"on-request","sandbox":"read-only"},25)["thread"]["id"]
        print("isolated diagnostic thread started",flush=True)
        tests=[
            ("browser-fast-hybrid","browser_fast_doctor",{}),
            ("china-check-public","search_chinese_company",{"query":"腾讯科技（深圳）有限公司","language":"zh"}),
            ("computer-history","computer_history_status",{}),
            ("convert3d-webmcp","get_capabilities",{}),
            ("ghidra-mcp","list_instances",{}),
            ("ghidra-mcp","list_tool_groups",{}),
            ("node_repl","js",{"code":"console.log(6 * 7)","title":"本地算术健康检查","timeout_ms":5000}),
            ("open-knowledge","config",{"cwd":folder,"key":"appearance.theme"}),
            ("openaiDeveloperDocs","search_openai_docs",{"query":"Codex app server","limit":1}),
            ("rea","inspect_wasm_artifact",{"path":str(artifact),"detail":"summary"}),
        ]
        def run(case):
            server,tool,args=case
            try: return summarize(server,tool,client.call("mcpServer/tool/call",{"threadId":thread,"server":server,"tool":tool,"arguments":args},75 if server=="convert3d-webmcp" else 40))
            except Exception as error: return {"server":server,"tool":tool,"failure":error_label(error)}
        with cf.ThreadPoolExecutor(5) as pool:
            futures=[pool.submit(run,case) for case in tests]
            for future in cf.as_completed(futures):
                print(json.dumps(future.result(),ensure_ascii=False),flush=True)
        try:
            client.call("mcpServer/tool/call",{"threadId":thread,"server":"convert3d-webmcp","tool":"close_session","arguments":{}},12)
        except Exception: pass
    finally: client.close()
