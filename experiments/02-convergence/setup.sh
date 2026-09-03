#!/usr/bin/env bash
#
# Stand up experiment 2: several independent readings of the same binary.
#
# One database, one server, N projects — because the property being measured is
# that the readings are independent, and separate projects give that without
# separate servers. They share a transcript, which is wanted: one file holds
# every call every reader made, so "did they reach for the same missing tool"
# is a grep rather than a merge.
#
# No reference. Experiment 1 handed over the answer and asked whether the API
# could express it; this asks whether the API can help someone *find* it, which
# is a different question and the one the tools are actually for.
#
# Usage:  ./setup.sh [readers] [run-directory]   (default: 3 readers, ./run)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
readers="${1:-3}"
run="${2:-$here/run}"
port="${RE64_PORT:-5165}"

if [ ! -f "$repo/dist/cli/index.js" ]; then
  echo "Building..." >&2
  (cd "$repo" && npm run build >/dev/null)
fi

# The lesson from trial 3: a stale server on this port answers every call and
# looks exactly like a fresh project that mysteriously remembers a previous run.
if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $port is already in use. Stop that server first, or set RE64_PORT." >&2
  exit 1
fi

rm -rf "$run"
mkdir -p "$run"
cp "$repo/assets/gridrunner/gridrunner.prg" "$run/"

db="$run/convergence.re64db"
names=()
for i in $(seq 1 "$readers"); do
  name="reader-$i"
  names+=("$name")
  cat > "$run/$name.re64" <<JSON
{
  "name": "$name",
  "description": "Gridrunner, unannotated: one independent reading",
  "layers": [{ "type": "prg", "path": "gridrunner.prg" }]
}
JSON
  node "$repo/dist/cli/index.js" import "$run/$name.re64" --db "$db" >/dev/null
done

node "$repo/dist/server/index.js" "$db" --port "$port" &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT INT TERM

sleep 2
if ! curl -sf "http://127.0.0.1:$port/api/projects" >/dev/null; then
  echo "The server did not come up on port $port." >&2
  exit 1
fi

cat <<EOF

Experiment 2 is up: $readers independent readings, no reference.

  projects    ${names[*]}
  database    $db
  transcript  $run/convergence.mcp.jsonl
  watch       http://127.0.0.1:$port/?project=reader-1

Each reader calls tools with its own project, user and session:

  RE64_PORT=$port RE64_USER=reader-1 RE64_SESSION=reader-1 \\
    $repo/experiments/mcp-call.sh describe_project '{"project":"reader-1"}'

Give each one experiments/02-convergence/brief.md with PROJECT set to its name.

Read the run:

  node $repo/dist/cli/index.js transcript "$run/convergence.mcp.jsonl"

Ctrl-C stops the server.
EOF

wait $server
