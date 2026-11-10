import json
import os
import stat
import tempfile
from pathlib import Path

data = Path.home() / ".openmausbot"
config_path = data / "config.json"
bots = json.loads((data / "bots.json").read_text())
selected = [b for b in bots if b.get("name") == "Codex" and b.get("modelSelection", {}).get("instanceId") == "codex-local" and not b.get("hidden")]
if len(selected) != 1:
    raise SystemExit("Expected exactly one active local Codex bot.")
bot = selected[0]
if bot.get("approvalCeiling") != "ask":
    raise SystemExit("The Codex bot's approval ceiling changed.")
if bot.get("mcpServers") is not None and "github-readonly" not in bot["mcpServers"]:
    raise SystemExit("The Codex bot uses an explicit server list. The current selection was preserved.")
helper = Path(__file__).with_name("github-readonly.py").resolve()
if not helper.is_file():
    raise SystemExit("The tested GitHub connector is missing.")
entry = {"command": "/opt/homebrew/bin/python3", "args": [str(helper)], "enabled": True, "bot": bot["id"]}
cfg = json.loads(config_path.read_text())
servers = cfg.setdefault("mcpServers", {})
if not isinstance(servers, dict):
    raise SystemExit("Existing MCP configuration is invalid.")
if "github-readonly" in servers:
    if servers["github-readonly"] != entry:
        raise SystemExit("A different GitHub connector already uses this name.")
else:
    servers["github-readonly"] = entry
    mode = stat.S_IMODE(config_path.stat().st_mode)
    with tempfile.NamedTemporaryFile("w", dir=data, prefix=".github-mcp-config.", delete=False) as file:
        temp = Path(file.name)
        try:
            os.fchmod(file.fileno(), mode)
            json.dump(cfg, file, ensure_ascii=False, indent=2)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
            os.replace(temp, config_path)
        finally:
            temp.unlink(missing_ok=True)
assert json.loads(config_path.read_text())["mcpServers"]["github-readonly"] == entry
print(json.dumps({"mcp": "github-readonly", "enabled": True, "bot": "Codex", "repository": "SvenKunkka/OpenMausBot"}))
