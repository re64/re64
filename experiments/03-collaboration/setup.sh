#!/usr/bin/env bash
#
# Stand up experiment 3: two agents, one document.
#
# Experiment 2 gave five readers five independent clones, because the property
# being measured was that their readings were independent. This is the opposite:
# ONE project, shared, with a chat and a participant list, and a person watching
# without taking part.
#
# Deliberately open-ended. There is no hypothesis here and no behaviour being
# looked for — an earlier draft of the plan named one, which was the author
# guessing, and naming an expected finding in advance is how you stop seeing the
# others. Run it, watch, report what happened.
#
# Two agents rather than five, because Gridrunner is 4KB: more readers on a
# program this size would mostly measure collision noise. They are given a lens
# each and NOT an address range — the program's own structure decides where they
# meet, which is the interesting part.
#
# No claims, no leases, no work assignment. Whatever coordination looks like
# here should be theirs, not something the harness pre-decided.
#
# Usage:  ./setup.sh [run-directory]   (default: ./run)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
run="${1:-$here/run}"
port="${RE64_PORT:-5168}"

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
cp "$repo/assets/gridrunner.prg" "$run/"

# The bytes and nothing else, exactly as experiment 2 started. Blank keeps the
# work real and the result comparable to the solo readings.
cat > "$run/gridrunner.re64" <<'JSON'
{
  "name": "gridrunner",
  "description": "Gridrunner, unannotated: two readers, one document",
  "layers": [{ "type": "prg", "path": "gridrunner.prg" }]
}
JSON

node "$repo/dist/cli/index.js" import "$run/gridrunner.re64" >/dev/null

nohup node "$repo/dist/server/index.js" "$run/gridrunner.re64db" \
  --port "$port" > "$run/server.log" 2>&1 &
echo $! > "$run/server.pid"

sleep 2
if ! curl -sf "http://127.0.0.1:$port/api/projects" >/dev/null; then
  echo "The server did not come up on port $port. See $run/server.log" >&2
  exit 1
fi

cat <<EOF

Experiment 3 is up, detached. One project, two readers, shared.

  project     gridrunner   (blank: the bytes and nothing else)
  transcript  $run/gridrunner.mcp.jsonl
  server      pid $(cat "$run/server.pid"), log $run/server.log
  watch       http://127.0.0.1:$port/?project=gridrunner

Both readers call the same project, with their own identity and session:

  RE64_PORT=$port RE64_USER=lead RE64_SESSION=lead \\
    $repo/experiments/mcp-call.sh list_participants '{"project":"gridrunner"}'

Briefs: brief-lead.md and brief-gfx.md in this directory.

Read the run:

  node $repo/dist/cli/index.js transcript "$run/gridrunner.mcp.jsonl"

Stop the server:

  kill \$(cat "$run/server.pid")
EOF
