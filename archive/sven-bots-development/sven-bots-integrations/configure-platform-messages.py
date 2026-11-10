import json
import os
import stat
import tempfile
from pathlib import Path


root = Path.home() / ".openmausbot"
config = root / "config.json"
bots = json.loads((root / "bots.json").read_text())
selected = [
    bot for bot in bots
    if bot.get("name") == "Codex" and not bot.get("hidden")
    and bot.get("modelSelection", {}).get("instanceId") == "codex-local"
]
if len(selected) != 1 or selected[0].get("approvalCeiling") != "ask":
    raise SystemExit("Expected one active Codex bot with approval required.")
bot = selected[0]
name = "platform-messages"
if bot.get("mcpServers") is not None and name not in bot["mcpServers"]:
    raise SystemExit("The bot has an explicit MCP list. No settings were changed.")
helper = Path(__file__).with_name("platform-messages.py").resolve(strict=True)
database = Path.home() / "Library/Application Support/Bot Inbox/inbox.sqlite"
entry = {
    "command": "/opt/homebrew/bin/python3",
    "args": [str(helper), "--profile", os.environ["SVEN_BOTS_FEISHU_PROFILE"], "--inbox", str(database)],
    "enabled": True,
    "bot": bot["id"],
}
settings = json.loads(config.read_text())
servers = settings.setdefault("mcpServers", {})
if not isinstance(servers, dict) or name in servers and servers[name] != entry:
    raise SystemExit("The MCP server name is already used or settings have an unexpected format.")
if name not in servers:
    servers[name] = entry
    with tempfile.NamedTemporaryFile("w", dir=root, prefix=".platform-mcp.", delete=False) as file:
        temp = Path(file.name)
        try:
            os.fchmod(file.fileno(), stat.S_IMODE(config.stat().st_mode))
            json.dump(settings, file, ensure_ascii=False, indent=2)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
            os.replace(temp, config)
        finally:
            temp.unlink(missing_ok=True)
assert json.loads(config.read_text())["mcpServers"][name] == entry
print(json.dumps({"connector": name, "enabled": True, "bot": bot["name"]}))
