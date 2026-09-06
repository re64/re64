#!/usr/bin/env bash
#
# Stand up experiment 8: Gridrunner from nothing, on the claims model.
#
# Every earlier run on this binary used the reference project, which arrives
# already annotated — so what they measured was reading *on top of* somebody
# else's work. This starts from the bytes: one PRG layer, no claims, no
# comments, no targets anybody declared.
#
# It is deliberately the same binary the earlier runs used, because the point is
# not a harder program. It is the same program against a model and an API that
# have both been replaced since: labels and regions became claims, the vocabulary
# became additive, and a view became a parameter of the request. What is being
# measured is whether that shows up in how somebody works.
#
# Two runs, one per directory, so a solo reader and a pair start identically and
# cannot see each other.
#
# Usage:  ./setup.sh <run-directory> <port> <project-name>
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
run="${1:?usage: setup.sh <run-directory> <port> <project-name>}"
port="${2:?}"
name="${3:?}"
call="$repo/experiments/mcp-call.sh"

if [ ! -f "$repo/dist/cli/index.js" ]; then
  echo "Building..." >&2
  (cd "$repo" && npm run build >/dev/null)
fi

if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $port is already in use." >&2
  exit 1
fi

rm -rf "$run"
mkdir -p "$run"
cp "$repo/assets/gridrunner/gridrunner.prg" "$run/"

echo "{ \"name\": \"$name\", \"layers\": [] }" > "$run/$name.re64"
node "$repo/dist/cli/index.js" import "$run/$name.re64" >/dev/null

nohup node "$repo/dist/server/index.js" "$run/$name.re64db" \
  --port "$port" > "$run/server.log" 2>&1 &
echo $! > "$run/server.pid"

sleep 2
curl -sf "http://127.0.0.1:$port/api/projects" >/dev/null || {
  echo "The server did not come up. See $run/server.log" >&2; exit 1; }

c() { RE64_PORT="$port" RE64_USER=setup RE64_SESSION=setup "$call" "$@"; }

# The bytes, and nothing else. A reader gets what a person would have on the
# first day: a file, and no idea what is in it.
url=$(c prepare_upload "{\"project\":\"$name\",\"name\":\"gridrunner.prg\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["url"])')
curl -sf -X PUT --data-binary "@$run/gridrunner.prg" "$url" >/dev/null

c add_byte_layer "{\"project\":\"$name\",\"type\":\"prg\",\"path\":\"gridrunner.prg\",\"name\":\"gridrunner\"}" >/dev/null

c describe_project "{\"project\":\"$name\"}" > "$run/seeded.json"
python3 - "$run/seeded.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
c = d.get("counts", {})
print(f"  seeded: {c.get('instructions','?')} instructions decoded, "
      f"{c.get('namedByHand','?')} names by hand, target {d.get('target','-')}",
      file=sys.stderr)
PY

cat <<EOF

$name is up on port $port.

  database    $run/$name.re64db
  transcript  $run/$name.mcp.jsonl
  server      pid $(cat "$run/server.pid"), log $run/server.log
  watch       http://127.0.0.1:$port/?project=$name

Stop:  kill \$(cat "$run/server.pid")
EOF
