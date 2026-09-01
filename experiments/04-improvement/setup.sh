#!/usr/bin/env bash
#
# Stand up experiment 4: beat the human.
#
# Experiment 1 handed over the reference and asked whether the API could *say*
# what a person said. This hands over the same reference and asks the opposite
# question: where is the person **wrong**, and can the API say something better?
#
# That inverts what a disagreement means. In experiment 1 a difference from
# `reference.asm` was a defect in re64; here it is the point, and the burden is
# on the agent to show which reading is right. The oracle stops being an answer
# key and becomes a subject.
#
# The project is seeded with the human's own annotations rather than stripped:
# 102 labels and 16 regions, no comments. Starting blank would measure
# rediscovery, which experiment 2 already measured twice.
#
# Deliberately NOT supplied: this repository's CLAUDE.md. It records several
# things the human reference gets wrong or misses — the routine at $87FE that
# discards its own return address, the two readings of the contested bytes at
# $8D5A, the character set at $8E00 — which are exactly the findings this run
# exists to see whether an agent reaches on its own. The tool descriptions are
# in-band and are the intended documentation.
#
# Usage:  ./setup.sh [run-directory]   (default: ./run)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
run="${1:-$here/run}"
port="${RE64_PORT:-5166}"

if [ ! -f "$repo/dist/cli/index.js" ]; then
  echo "Building..." >&2
  (cd "$repo" && npm run build >/dev/null)
fi

# A stale server on this port answers every call and looks exactly like a fresh
# project that mysteriously remembers a previous run. Lesson from trial 3.
if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $port is already in use. Stop that server first, or set RE64_PORT." >&2
  exit 1
fi

rm -rf "$run"
mkdir -p "$run"
cp "$repo/assets/gridrunner.prg" "$run/"
cp "$repo/assets/gridrunner.asm" "$run/reference.asm"

# The human's project, under a name that says what the task is.
node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  p.name = "gridrunner-improved";
  p.description = "Gridrunner, seeded with the human reading; the task is to better it";
  fs.writeFileSync(process.argv[2], JSON.stringify(p, null, 2));
' "$repo/assets/gridrunner.re64" "$run/gridrunner-improved.re64"

node "$repo/dist/cli/index.js" import "$run/gridrunner-improved.re64" >/dev/null

nohup node "$repo/dist/server/index.js" "$run/gridrunner-improved.re64db" \
  --port "$port" > "$run/server.log" 2>&1 &
echo $! > "$run/server.pid"

sleep 2
if ! curl -sf "http://127.0.0.1:$port/api/projects" >/dev/null; then
  echo "The server did not come up on port $port. See $run/server.log" >&2
  exit 1
fi

cat <<EOF

Experiment 4 is up, detached.

  project     gridrunner-improved  (seeded: 102 labels, 16 regions, 0 comments)
  reference   $run/reference.asm   (the human reading, 65KB, ~334 labels)
  transcript  $run/gridrunner-improved.mcp.jsonl
  server      pid $(cat "$run/server.pid"), log $run/server.log
  watch       http://127.0.0.1:$port/?project=gridrunner-improved

Call a tool:

  RE64_PORT=$port RE64_USER=improver RE64_SESSION=improver \\
    $repo/experiments/mcp-call.sh describe_project '{"project":"gridrunner-improved"}'

Read the run:

  node $repo/dist/cli/index.js transcript "$run/gridrunner-improved.mcp.jsonl"

Stop the server:

  kill \$(cat "$run/server.pid")
EOF
