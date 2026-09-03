#!/usr/bin/env bash
#
# Stand up experiment 6: read the KERNAL.
#
# Every target so far has been a game — a program somebody wrote once, with a
# beginning and an end. This is 8KB of forty-year-old system ROM: dense,
# entered through a jump table, threaded with indirect vectors through RAM, and
# with a documented public interface that we already ship names for and have
# never checked.
#
# Two questions at once, which is the point. Whether re64 is up to reading a
# ROM — different in kind from a game, and the hardest static-analysis target
# available. And whether the effects its own analysis derives for the KERNAL's
# documented entry points are *right*, since those are the facts we would ship
# as a substitute for the ROM itself.
#
# The ROM is not in this repository and never will be. See 3party/roms/README.md
# for what to put there.
#
# Usage:  ./setup.sh [run-directory]   (default: ./run)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
run="${1:-$here/run}"
port="${RE64_PORT:-5172}"
rom="$repo/3party/roms/kernal.901227-03.bin"

if [ ! -f "$rom" ]; then
  echo "No KERNAL ROM at $rom" >&2
  echo "See 3party/roms/README.md for which file to put there." >&2
  exit 1
fi

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
cp "$rom" "$run/kernal.bin"

# A raw layer: a .bin carries no load address, and the KERNAL's is $E000.
cat > "$run/kernal.re64" <<'JSON'
{
  "name": "kernal",
  "description": "C64 KERNAL ROM 901227-03, read as a program",
  "layers": [{ "type": "raw", "path": "kernal.bin", "address": "$E000" }]
}
JSON

node "$repo/dist/cli/index.js" import "$run/kernal.re64" >/dev/null

nohup node "$repo/dist/server/index.js" "$run/kernal.re64db" \
  --port "$port" > "$run/server.log" 2>&1 &
echo $! > "$run/server.pid"

sleep 2
if ! curl -sf "http://127.0.0.1:$port/api/projects" >/dev/null; then
  echo "The server did not come up on port $port. See $run/server.log" >&2
  exit 1
fi

cat <<EOF

Experiment 6 is up, detached. 8KB of KERNAL at \$E000-\$FFFF.

  project     kernal
  transcript  $run/kernal.mcp.jsonl
  server      pid $(cat "$run/server.pid"), log $run/server.log
  watch       http://127.0.0.1:$port/?project=kernal

  RE64_PORT=$port RE64_USER=reader RE64_SESSION=reader \\
    $repo/experiments/mcp-call.sh describe_project '{"project":"kernal"}'

Stop the server:  kill \$(cat "$run/server.pid")
EOF
