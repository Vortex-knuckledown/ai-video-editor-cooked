#!/bin/bash
# runtime.sh: what the cooked. app needs to run, checked and installed without Homebrew or a password.
#
#   runtime.sh check      one line per tool: "ok <tool> <path>" or "missing <tool>"
#   runtime.sh install    download what is missing into ~/.ai-video-editor/runtime (Python, Node, ffmpeg, ffprobe),
#                         printing "step <tool> <what is happening>" lines for the setup window
#   runtime.sh claude     install Claude Code with Anthropic's own installer (no password)
#   runtime.sh path       print the PATH the app runs everything with
#
# Tools already on the computer (Homebrew, nvm, python.org) are used as they are; only what is missing is fetched.
set -u
HOME_DIR="${AI_EDITOR_HOME:-$HOME/.ai-video-editor}"
RT="$HOME_DIR/runtime"
ARCH="$(uname -m)"   # arm64 or x86_64

app_path() {
  local nvm=""
  if [ -d "$HOME/.nvm/versions/node" ]; then
    nvm="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
  fi
  echo "$RT/python/bin:$RT/node/bin:$RT/bin:$HOME/.local/bin:${nvm:+$nvm:}/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
}
export PATH="$(app_path)"

# a Python new enough for the editor (3.10+); macOS's own /usr/bin/python3 is 3.9
find_python() {
  local p
  for p in "$RT/python/bin/python3" python3.13 python3.12 python3.11 python3.10 python3; do
    p="$(command -v "$p" 2>/dev/null)" || continue
    if "$p" -c 'import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 13) else 1)' 2>/dev/null; then
      echo "$p"; return 0
    fi
  done
  return 1
}

check() {
  local p
  if p="$(find_python)"; then echo "ok python $p"; else echo "missing python"; fi
  for t in node ffmpeg ffprobe claude; do
    if p="$(command -v "$t" 2>/dev/null)"; then echo "ok $t $p"; else echo "missing $t"; fi
  done
}

get() {   # get <url> <file>
  curl -fL --retry 3 --connect-timeout 20 -sS -o "$2" "$1"
}

install_python() {
  echo "step python finding the newest build"
  local tag triple name
  tag="$(curl -fsSL --connect-timeout 20 https://raw.githubusercontent.com/astral-sh/python-build-standalone/latest-release/latest-release.json | sed -n 's/.*"tag": *"\([0-9]*\)".*/\1/p')"
  [ -n "$tag" ] || { echo "fail python could not reach the download site"; return 1; }
  triple="aarch64-apple-darwin"; [ "$ARCH" = "x86_64" ] && triple="x86_64-apple-darwin"
  name="$(curl -fsSL --connect-timeout 20 "https://github.com/astral-sh/python-build-standalone/releases/expanded_assets/$tag" \
          | grep -o "cpython-3\.12\.[0-9]*+$tag-$triple-install_only\.tar\.gz" | head -1)"
  [ -n "$name" ] || { echo "fail python no build for this Mac in release $tag"; return 1; }
  echo "step python downloading (about 20 MB)"
  get "https://github.com/astral-sh/python-build-standalone/releases/download/$tag/${name/+/%2B}" "$RT/python.tgz" || { echo "fail python download failed"; return 1; }
  rm -rf "$RT/python" && tar -xzf "$RT/python.tgz" -C "$RT" && rm -f "$RT/python.tgz"
  "$RT/python/bin/python3" -c 'import ssl, sqlite3' || { echo "fail python the download does not run on this Mac"; return 1; }
  echo "done python"
}

install_node() {
  local v="v22.12.0" a="arm64"; [ "$ARCH" = "x86_64" ] && a="x64"
  echo "step node downloading (about 45 MB)"
  get "https://nodejs.org/dist/$v/node-$v-darwin-$a.tar.gz" "$RT/node.tgz" || { echo "fail node download failed"; return 1; }
  rm -rf "$RT/node" "$RT/node-$v-darwin-$a" && tar -xzf "$RT/node.tgz" -C "$RT" && mv "$RT/node-$v-darwin-$a" "$RT/node" && rm -f "$RT/node.tgz"
  "$RT/node/bin/node" -v >/dev/null || { echo "fail node the download does not run on this Mac"; return 1; }
  echo "done node"
}

install_ff() {   # ffmpeg and ffprobe: static builds, one file each
  local a="arm64"; [ "$ARCH" = "x86_64" ] && a="amd64"
  local page rel t
  echo "step ffmpeg finding the newest build"
  page="$(curl -fsSL --connect-timeout 20 https://ffmpeg.martin-riedl.de/)" || { echo "fail ffmpeg could not reach the download site"; return 1; }
  mkdir -p "$RT/bin"
  for t in ffmpeg ffprobe; do
    command -v "$t" >/dev/null 2>&1 && continue
    rel="$(echo "$page" | grep -o "/download/macos/$a/[^\"]*/$t\.zip\"" | grep -v snapshot | tr -d '"' | tail -1)"
    [ -n "$rel" ] || rel="$(echo "$page" | grep -o "/download/macos/$a/[^\"]*/$t\.zip\"" | tr -d '"' | head -1)"
    [ -n "$rel" ] || { echo "fail $t no build for this Mac"; return 1; }
    echo "step $t downloading (about 25 MB)"
    get "https://ffmpeg.martin-riedl.de$rel" "$RT/$t.zip" || { echo "fail $t download failed"; return 1; }
    unzip -oq "$RT/$t.zip" -d "$RT/bin" && rm -f "$RT/$t.zip" && chmod +x "$RT/bin/$t"
    xattr -d com.apple.quarantine "$RT/bin/$t" 2>/dev/null
    "$RT/bin/$t" -version >/dev/null 2>&1 || { echo "fail $t the download does not run on this Mac"; return 1; }
    echo "done $t"
  done
}

install() {
  mkdir -p "$RT"
  local bad=0
  find_python >/dev/null || install_python || bad=1
  command -v node >/dev/null 2>&1 || install_node || bad=1
  if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then install_ff || bad=1; fi
  [ "$bad" = 0 ] && echo "ready" || echo "failed"
  return "$bad"
}

install_claude() {
  command -v claude >/dev/null 2>&1 && { echo "done claude"; return 0; }
  echo "step claude downloading Anthropic's installer"
  curl -fsSL --connect-timeout 20 https://claude.ai/install.sh -o "$RT/claude-install.sh" || { echo "fail claude could not reach claude.ai"; return 1; }
  echo "step claude installing"
  bash "$RT/claude-install.sh" >/dev/null 2>&1; rm -f "$RT/claude-install.sh"
  export PATH="$(app_path)"
  command -v claude >/dev/null 2>&1 && echo "done claude" || { echo "fail claude the installer did not finish"; return 1; }
}

case "${1:-check}" in
  check) check ;;
  install) install ;;
  claude) mkdir -p "$RT"; install_claude ;;
  path) app_path ;;
  python) find_python ;;
  *) echo "usage: runtime.sh check|install|claude|path|python" >&2; exit 2 ;;
esac
