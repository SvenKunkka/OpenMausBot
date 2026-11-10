import concurrent.futures as cf
import itertools, json, os, signal, subprocess, sys, tempfile, threading
from pathlib import Path

BASE = Path(__file__).resolve().parent
CLI = str(Path.home() / ".local/bin/codex")
SVEN_ARGS = [
    "-c", 'model_provider="openai"',
    "-c", "features.browser_use=false",
    "-c", "features.browser_use_external=false",
    "-c", "features.computer_use=false",
    "-c", 'plugins={ "browser@openai-bundled" = { enabled = false }, "computer-use@openai-bundled" = { enabled = false }, "unified-computer-use@openai-bundled" = { enabled = false } }',
]
class RpcFailure(Exception): pass
class Client:
    def __init__(self, args, cwd):
        env = {k: os.environ[k] for k in ("HOME","PATH","TMPDIR","LANG","LC_ALL","CODEX_HOME") if k in os.environ}
        env["PATH"] = ":".join(dict.fromkeys([str(Path.home()/".local/bin"),"/opt/homebrew/bin","/usr/local/bin",*env.get("PATH","").split(":")]))
        env["NPM_CONFIG_LOGLEVEL"]="error"
        self.p = subprocess.Popen([CLI, "app-server", *args], cwd=cwd, env=env, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1, start_new_session=True)
        self.pending, self.ids, self.lock = {}, itertools.count(1), threading.Lock()
        threading.Thread(target=self.reader, daemon=True).start()
        self.call("initialize", {"clientInfo":{"name":"openmausbot","title":"OpenMausBot","version":"0.1.151-workbench.5"},
                                 "capabilities":{"experimentalApi":True}}, 12)
        self.send({"method":"initialized","params":{}})
    def send(self, msg):
        with self.lock:
            self.p.stdin.write(json.dumps({"jsonrpc":"2.0",**msg})+"\n")
            self.p.stdin.flush()
    def reader(self):
        for line in self.p.stdout:
            try: msg = json.loads(line)
            except ValueError: continue
            if "method" in msg and "id" in msg:
                if msg["method"].endswith("requestApproval"):
                    self.send({"id":msg["id"],"result":{"decision":"decline"}})
                else:
                    self.send({"id":msg["id"],"error":{"code":-32000,"message":"No interaction authorized for the diagnostic"}})
            elif "id" in msg:
                result = self.pending.get(msg["id"])
                if result is not None and not result.done():
                    if "error" in msg: result.set_exception(RpcFailure(msg["error"]))
                    else: result.set_result(msg.get("result"))
        for future in list(self.pending.values()):
            if not future.done(): future.set_exception(RuntimeError("app-server exited"))
    def call(self, method, params=None, timeout=36):
        request = next(self.ids)
        future = self.pending[request] = cf.Future()
        try:
            self.send({"id":request,"method":method,"params":params or {}})
            return future.result(timeout=timeout)
        finally: self.pending.pop(request,None)
    def close(self):
        try: self.p.stdin.close()
        except OSError: pass
        try: self.p.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(self.p.pid, signal.SIGTERM)
            try: self.p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(self.p.pid, signal.SIGKILL); self.p.wait()
    def pages(self, method, params):
        data = []
        for _ in range(12):
            res = self.call(method, params, 50)
            data.extend(res.get("data", []))
            if not res.get("nextCursor"): return data
            params = {**params, "cursor":res["nextCursor"]}
        return data

def error_label(e):
    if isinstance(e, TimeoutError): return "timeout"
    if isinstance(e,RpcFailure):
        err=e.args[0]
        msg=err.get("message","").lower()
        groups={"not found":("not found","unknown server"),"auth error":("auth","401","403"),"not supported":("unsupported","not supported","not enabled"),"connection failed":("connect","closed","spawn"),"invalid parameters":("invalid","missing field")}
        return f"RPC {err.get('code')} " + next((tag for tag,patterns in groups.items() if any(p in msg for p in patterns)),"error")
    return type(e).__name__

def discovery(mode):
    args = SVEN_ARGS if mode == "sven" else []
    with tempfile.TemporaryDirectory(dir=BASE,prefix="session-") as folder:
        client = Client(args, folder)
        try:
            c=client.call("config/read",{"cwd":folder,"includeLayers":False})["config"]
            result={"mode":mode, "settings":{
                "servers":{name: entry.get("enabled",True) for name,entry in (c.get("mcp_servers") or {}).items()},
                "plugins":{name: entry.get("enabled",True) for name,entry in (c.get("plugins") or {}).items()},
                "appFeature":(c.get("features") or {}).get("apps",None)
            }}
            jobs={"apps": ("app/list",{"limit":100,"forceRefetch":True}), "mcp": ("mcpServerStatus/list",{"limit":100})}
            with cf.ThreadPoolExecutor(2) as pool:
                futures={key:pool.submit(client.pages,*job) for key,job in jobs.items()}
                for name,future in futures.items():
                    try:
                        value=future.result()
                        if name == "apps":
                            result[name]=[{"name":a["name"],"id":a["id"],"accessible":a.get("isAccessible"),"enabled":a.get("isEnabled")} for a in value]
                        else:
                            result[name]=[{k:entry.get(k) for k in ("name","authStatus","connectionStatus")} |
                                          {"tools":{name: {k:v.get(k) for k in ("name","description","inputSchema","annotations")} for name,v in (entry.get("tools") or {}).items()},
                                           "resources":len(entry.get("resources") or []),"templates":len(entry.get("resourceTemplates") or [])} for entry in value]
                    except Exception as e: result[name+"Error"]=error_label(e)
            target=BASE/f"{mode}-catalog.json"
            target.write_text(json.dumps(result,ensure_ascii=False,indent=2)); target.chmod(0o600)
            print(json.dumps({k:v for k,v in result.items() if k not in ("mcp","apps")} | {
                 "apps": [a for a in result.get("apps",[]) if a["accessible"]],
                 "appsListed":len(result.get("apps",[])),
                 "mcp":[entry | {"tools":len(entry["tools"])} for entry in result.get("mcp",[])]},ensure_ascii=False),flush=True)
        finally: client.close()

if __name__=="__main__": discovery(sys.argv[1])
