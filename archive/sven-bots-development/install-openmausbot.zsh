#!/bin/zsh
set -euo pipefail

installer="$1"
mount_dir="$PWD/work/openmausbot-mount"
destination="/Applications/OpenMausBot.app"
expected=138ef8f7bd75a99c89816be7335299bc40d46b570ac336649de0322e78922b07

printf '%s  %s\n' "$expected" "$installer" | shasum -a 256 -c
if [[ -e "$destination" || -L "$destination" ]]; then
  printf 'Install destination already exists: %s\n' "$destination" >&2
  exit 1
fi
mkdir -p "$mount_dir"
hdiutil attach -nobrowse -readonly -mountpoint "$mount_dir" "$installer"
stage=""
trap 'hdiutil detach "$mount_dir" >/dev/null || true; if [[ -n "$stage" && -d "$stage" ]]; then rm -rf -- "$stage"; fi' EXIT

source="$mount_dir/OpenMausBot.app"
codesign --verify --deep --strict "$source"
spctl --assess --type execute --verbose=2 "$source"
stage=$(mktemp -d /Applications/.OpenMausBot-install.XXXXXXXX)
ditto "$source" "$stage/OpenMausBot.app"
codesign --verify --deep --strict "$stage/OpenMausBot.app"
[[ ! -e "$destination" && ! -L "$destination" ]]
mv -n "$stage/OpenMausBot.app" "$destination"
[[ ! -e "$stage/OpenMausBot.app" && -d "$destination" ]]
/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$destination/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$destination/Contents/Info.plist"
