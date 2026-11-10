#!/bin/zsh
set -euo pipefail

source_dir="$PWD/work/OpenMausBot-source"
export_dir="$PWD/work/OpenMausBot-oss-export.git"
upstream=b33a1c6437e2b5ea55000d89210727812ea2f21d
[[ "$(git -C "$source_dir" rev-parse 'v0.1.151^{commit}')" == "$upstream" ]]
[[ -z "$(git --git-dir="$export_dir" for-each-ref 2>/dev/null || true)" ]]
git init --quiet --bare --initial-branch=main "$export_dir"

export GIT_DIR="$export_dir"
export GIT_WORK_TREE="$source_dir"

export GIT_INDEX_FILE="$export_dir/index"
export GIT_ALTERNATE_OBJECT_DIRECTORIES="$source_dir/.git/objects"
git read-tree "$upstream"
git ls-files -z -- enterprise/ | git update-index --force-remove -z --stdin
oss_tree=$(git write-tree)
git ls-tree -r -z "$upstream" > "$export_dir/upstream-tree"
git ls-tree -r -z "$oss_tree" > "$export_dir/oss-tree"
python3 - "$export_dir" <<'PY'
import pathlib
import sys

repo = pathlib.Path(sys.argv[1])
original = (repo / "upstream-tree").read_bytes().rstrip(b"\0").split(b"\0")
exported = (repo / "oss-tree").read_bytes().rstrip(b"\0").split(b"\0")
allowed = [entry for entry in original if not entry.split(b"\t", 1)[1].startswith(b"enterprise/")]
if exported != allowed or len(allowed) == len(original):
    raise SystemExit("Export has differences outside the enterprise/ carve-out")
print(f"Verified {len(exported)} upstream OSS paths and {len(original) - len(exported)} enterprise paths excluded")
PY
commit=$(printf 'Import OpenMausBot OSS v0.1.151\n\nUpstream: https://github.com/milind-soni/OpenMausBot/tree/%s\nExclude enterprise/ per the upstream LICENSING.md carve-out.\n' "$upstream" | git -c user.name=Codex -c user.email=codex@users.noreply.github.com -c commit.gpgsign=false commit-tree "$oss_tree")
git update-ref refs/heads/main "$commit"
git update-ref refs/tags/upstream-v0.1.151-oss "$commit"
printf 'Import commit %s\nOSS tree %s\n' "$commit" "$oss_tree"
