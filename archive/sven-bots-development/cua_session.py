import itertools
import json
import subprocess
import sys

driver = subprocess.Popen(
    ["cua-driver", "mcp"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    text=True,
    bufsize=1,
)
ids = itertools.count(1)

def send(payload):
    driver.stdin.write(json.dumps({"jsonrpc": "2.0", **payload}) + "\n")
    driver.stdin.flush()

def request(method, params):
    request_id = next(ids)
    send({"id": request_id, "method": method, "params": params})
    for line in driver.stdout:
        message = json.loads(line)
        if message.get("id") == request_id:
            return message
    raise RuntimeError("Cua driver connection closed")

request("initialize", {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {"name": "OpenMausBot setup", "version": "1"},
})
send({"method": "notifications/initialized"})

for line in sys.stdin:
    try:
        call = json.loads(line)
        response = request("tools/call", {
            "name": call["name"], "arguments": call.get("args", {}),
        })
        result = response.get("result", response)
        if "structuredContent" in result:
            result = result["structuredContent"]
            if call.get("tree") and "tree_markdown" in result:
                result = {k: v for k, v in result.items() if k not in ("elements", "screenshot_base64")}
        elif "content" in result:
            result = [item for item in result["content"] if item["type"] == "text"]
        print(json.dumps(result, ensure_ascii=False), flush=True)
    except Exception as exc:
        print(str(exc), flush=True)
driver.stdin.close()
