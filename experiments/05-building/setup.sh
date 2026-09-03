#!/usr/bin/env bash
#
# Stand up experiment 5: build a project from a disk image.
#
# Every run before this was handed a project that already existed — layers
# declared, bytes loaded, entry points resolved. This starts with a server
# holding no project at all and a .d64 on disk, so the whole path that had never
# been exercised by anything but the CLI is the task: create a project, get the
# binary in, look inside the image, lay a layer over what is in there, and find
# where the program actually starts.
#
# The target is roughly ten times Gridrunner and loads at $0801 behind a BASIC
# stub rather than being a cartridge, so the entry point is not the load address
# and nothing in the tooling can guess it.
#
# Each agent creates its OWN project on the shared server, which is also the
# first real test of create_project. They do not collide: separate projects, one
# database.
#
# Usage:  ./setup.sh [run-directory]   (default: ./run)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
run="${1:-$here/run}"
port="${RE64_PORT:-5171}"

if [ ! -f "$repo/dist/cli/index.js" ]; then
  echo "Building..." >&2
  (cd "$repo" && npm run build >/dev/null)
fi

if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $port is already in use. Stop that server first, or set RE64_PORT." >&2
  exit 1
fi

rm -rf "$run"
mkdir -p "$run"

# The disk image, and nothing else. No .prg, no project, no reference.
cp "$repo/assets/mutant-camels/revenge-of-the-mutant-camels.d64" "$run/"

# A database with one empty project, so the server has something to open. The
# agents make their own beside it.
echo '{ "name": "empty", "layers": [] }' > "$run/workspace.re64"
node "$repo/dist/cli/index.js" import "$run/workspace.re64" >/dev/null

nohup node "$repo/dist/server/index.js" "$run/workspace.re64db" \
  --port "$port" > "$run/server.log" 2>&1 &
echo $! > "$run/server.pid"

sleep 2
if ! curl -sf "http://127.0.0.1:$port/api/projects" >/dev/null; then
  echo "The server did not come up on port $port. See $run/server.log" >&2
  exit 1
fi

cat <<EOF

Experiment 5 is up, detached. No project, one disk image.

  image       $run/revenge-of-the-mutant-camels.d64
  database    $run/workspace.re64db
  transcript  $run/workspace.mcp.jsonl
  server      pid $(cat "$run/server.pid"), log $run/server.log
  watch       http://127.0.0.1:$port/

  RE64_PORT=$port RE64_USER=builder-1 RE64_SESSION=builder-1 \\
    $repo/experiments/mcp-call.sh create_project '{"name":"camels-1"}'

Stop the server:  kill \$(cat "$run/server.pid")
EOF
