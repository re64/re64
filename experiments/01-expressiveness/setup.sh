#!/usr/bin/env bash
#
# Stand up experiment 1: a project holding the bytes and nothing else, a server
# with a transcript running, and the command to point an agent at it.
#
# The project is stripped on purpose. The existing gridrunner.re64 already
# contains the answer, and handing that over would leave nothing to express.
#
# Usage:  ./setup.sh [run-directory]   (default: ./run)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
run="${1:-$here/run}"
port="${RE64_PORT:-5164}"

if [ ! -f "$repo/dist/cli/index.js" ]; then
  echo "Building..." >&2
  (cd "$repo" && npm run build >/dev/null)
fi

rm -rf "$run"
mkdir -p "$run"
cp "$repo/assets/gridrunner.prg" "$run/"
cp "$repo/assets/gridrunner.asm" "$run/reference.asm"

# The bytes, and nothing else. Analysis still generates sub_/loc_/dat_ names and
# the built-in C64 layer still supplies KERNAL symbols, which is what a person
# starting from a bare binary would also have.
cat > "$run/gridrunner-blank.re64" <<'JSON'
{
  "name": "gridrunner-blank",
  "description": "Gridrunner with no annotations: the subject of experiment 1",
  "layers": [
    {
      "type": "prg",
      "path": "gridrunner.prg"
    }
  ]
}
JSON

node "$repo/dist/cli/index.js" import "$run/gridrunner-blank.re64" >/dev/null
node "$repo/dist/server/index.js" "$run/gridrunner-blank.re64db" --port "$port" &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT INT TERM

sleep 2
if ! curl -sf "http://127.0.0.1:$port/api/projects" >/dev/null; then
  echo "The server did not come up on port $port." >&2
  exit 1
fi

cat <<EOF

Experiment 1 is up.

  project     gridrunner-blank
  reference   $run/reference.asm
  transcript  $run/gridrunner-blank.mcp.jsonl
  watch       http://127.0.0.1:$port/?project=gridrunner-blank

Connect an agent:

  claude mcp add --transport http re64 http://127.0.0.1:$port/mcp \\
    --header "X-Re64-User: agent" \\
    --header "X-Re64-Session: \$RANDOM"

The session header is what keeps two agents from sharing one undo scope. If the
host issues its own Mcp-Session-Id it takes precedence and this can be dropped —
which is the thing this run is also measuring.

Give the agent experiments/01-expressiveness/brief.md, with REFERENCE set to the
path above.

Read the run:

  node $repo/dist/cli/index.js transcript "$run/gridrunner-blank.mcp.jsonl"

Ctrl-C stops the server.
EOF

wait $server
