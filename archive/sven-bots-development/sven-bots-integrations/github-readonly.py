import base64
import json
import os
import re
import subprocess
import sys
from urllib.parse import quote

ACCOUNT = "SvenKunkka"
REPOSITORY = "SvenKunkka/OpenMausBot"
GH = "/opt/homebrew/bin/gh"
MAX_FILE_BYTES = 64 * 1024
MAX_REQUEST_BYTES = 32 * 1024
PATH_PART = re.compile(r"[A-Za-z0-9._@+ -]{1,100}")
ANNOTATIONS = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True}
TOOLS = [
    {
        "name": "github_repository",
        "description": "Read identity, visibility and default branch of SvenKunkka/OpenMausBot.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": ANNOTATIONS,
    },
    {
        "name": "github_read_file",
        "description": "Read a UTF-8 file (up to 64 KiB) from the default branch of SvenKunkka/OpenMausBot and return its Git blob SHA.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "Relative file path, for example README.md.", "minLength": 1, "maxLength": 320}},
            "required": ["path"],
            "additionalProperties": False,
        },
        "annotations": ANNOTATIONS,
    },
]


class ReadFailure(Exception):
    pass


def github_get(endpoint):
    env = {key: os.environ[key] for key in ("HOME", "PATH", "TMPDIR", "XDG_CONFIG_HOME", "GH_CONFIG_DIR") if key in os.environ}
    env.update({"GH_PROMPT_DISABLED": "1", "GH_NO_UPDATE_NOTIFIER": "1", "GH_NO_EXTENSION_UPDATE_NOTIFIER": "1"})
    try:
        call = subprocess.run(
            [GH, "api", "--hostname", "github.com", "--method", "GET", endpoint],
            env=env, capture_output=True, text=True, timeout=12, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise ReadFailure("GitHub CLI was unavailable or timed out.") from None
    if call.returncode:
        status = re.search(r"HTTP ([1-5][0-9]{2})", call.stderr)
        raise ReadFailure(f"GitHub returned HTTP {status[1]}." if status else "GitHub CLI could not read the requested resource.")
    try:
        data = json.loads(call.stdout)
    except ValueError:
        raise ReadFailure("GitHub did not return JSON.") from None
    if not isinstance(data, dict):
        raise ReadFailure("GitHub did not return a file or repository record.")
    return data


def requested_path(arguments):
    path = arguments.get("path")
    if not isinstance(path, str) or not 1 <= len(path) <= 320 or set(arguments) != {"path"}:
        raise ReadFailure("Provide one valid relative file path.")
    parts = path.split("/")
    if any(part in {".", ".."} or not PATH_PART.fullmatch(part) for part in parts):
        raise ReadFailure("The file path contains an unsupported segment.")
    return path, "/".join(quote(part, safe="") for part in parts)


def call_tool(name, arguments):
    if not isinstance(arguments, dict):
        raise ReadFailure("Tool arguments must be an object.")
    if name == "github_repository" and not arguments:
        requested = None
    elif name == "github_read_file":
        requested = requested_path(arguments)
    else:
        raise ReadFailure("Unknown tool or invalid arguments.")
    if str(github_get("user").get("login", "")).lower() != ACCOUNT.lower():
        raise ReadFailure(f"Select the existing {ACCOUNT} login in GitHub CLI before reading.")
    endpoint = "repos/" + REPOSITORY
    if requested is None:
        result = github_get(endpoint)
        if str(result.get("full_name", "")).lower() != REPOSITORY.lower():
            raise ReadFailure("GitHub returned an unexpected repository.")
        return {key: result[key] for key in ("full_name", "private", "default_branch") if key in result}
    path, encoded = requested
    entry = github_get(endpoint + "/contents/" + encoded)
    if entry.get("path") != path or entry.get("type") != "file" or entry.get("encoding") != "base64":
        raise ReadFailure("The path is not a regular text file returned by GitHub.")
    size, encoded_content = entry.get("size"), entry.get("content")
    if type(size) is not int or not 0 <= size <= MAX_FILE_BYTES or not isinstance(encoded_content, str):
        raise ReadFailure("GitHub file exceeds the 64 KiB text limit.")
    try:
        content = base64.b64decode("".join(encoded_content.split()), validate=True)
        if len(content) != size or b"\0" in content:
            raise ValueError
        decoded = content.decode("utf-8")
    except ValueError:
        raise ReadFailure("GitHub file is not valid UTF-8 text.") from None
    return {"repository": REPOSITORY, "path": path, "blobSha": entry.get("sha"), "content": decoded}


def reply(request):
    method = request.get("method")
    params = request.get("params") if isinstance(request.get("params"), dict) else {}
    request_id = request.get("id")
    if "id" not in request:
        return None
    result = {"jsonrpc": "2.0", "id": request_id}
    if method == "initialize":
        offered = params.get("protocolVersion")
        version = offered if offered in {"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"} else "2024-11-05"
        result["result"] = {"protocolVersion": version, "capabilities": {"tools": {}}, "serverInfo": {"name": "github-readonly", "version": "1.0.0"}}
    elif method == "ping":
        result["result"] = {}
    elif method == "tools/list":
        result["result"] = {"tools": TOOLS}
    elif method == "tools/call":
        try:
            data = call_tool(params.get("name"), params.get("arguments", {}))
            result["result"] = {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
        except ReadFailure as error:
            result["result"] = {"isError": True, "content": [{"type": "text", "text": str(error)}]}
    else:
        result["error"] = {"code": -32601, "message": "Method not found"}
    return result


while line := sys.stdin.buffer.readline(MAX_REQUEST_BYTES + 1):
    if len(line) > MAX_REQUEST_BYTES:
        break
    try:
        request = json.loads(line)
    except ValueError:
        continue
    if not isinstance(request, dict) or request.get("jsonrpc") != "2.0":
        continue
    response = reply(request)
    if response is not None:
        print(json.dumps(response, ensure_ascii=False), flush=True)
