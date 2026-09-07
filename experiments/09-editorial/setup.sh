#!/usr/bin/env bash
#
# Stand up experiment 9: two readers and an editor on Revenge of the Mutant Camels.
#
# The project is prepared rather than started from bare bytes, because getting
# past a decruncher is settled territory — experiment 5 established the move and
# the machine model has since made it a scenario. What this run is for is what
# happens *after*: two readers sharing a document, and a third agent who has to
# turn what they find into something a person would read.
#
# The preparation itself uses the mechanisms the readers have, so a scenario and
# a capture are already in the project when they arrive. That is deliberate: a
# mechanism nobody can see is a mechanism nobody uses, and experiment 8 showed
# `view: "snippet:"` sitting unused for exactly that reason.
#
# Usage:  ./setup.sh [run-directory] [port] [project-name]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
run="${1:-$here/run}"
port="${2:-5192}"
name="${3:-camels}"
call="$repo/experiments/mcp-call.sh"

[ -f "$repo/dist/server/index.js" ] || { echo "Building..." >&2; (cd "$repo" && npm run build >/dev/null); }

if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $port is already in use." >&2; exit 1
fi

rm -rf "$run"; mkdir -p "$run"
cp "$repo/assets/mutant-camels/revenge-of-the-mutant-camels.d64" "$run/revenge.d64"

echo "{ \"name\": \"$name\", \"layers\": [] }" > "$run/$name.re64"
node "$repo/experiments/import.mjs" "$run/$name.re64" >/dev/null

nohup node "$repo/dist/server/index.js" "$run/$name.re64db" --port "$port" \
  > "$run/server.log" 2>&1 &
echo $! > "$run/server.pid"
sleep 2
curl -sf "http://127.0.0.1:$port/api/projects" >/dev/null || {
  echo "The server did not come up. See $run/server.log" >&2; exit 1; }

c() { RE64_PORT="$port" RE64_USER=setup RE64_SESSION=setup "$call" "$@"; }
j() { python3 -c 'import sys,json;print(json.load(sys.stdin)'"$1"')'; }

# The disk, over HTTP: 175KB of base64 through a tool argument would be tens of
# thousands of tokens for a file nothing reads.
url=$(c prepare_upload "{\"project\":\"$name\",\"name\":\"revenge.d64\"}" | j '["url"]')
curl -sf -X PUT --data-binary "@$run/revenge.d64" "$url" >/dev/null

c add_byte_layer "{\"project\":\"$name\",\"type\":\"prg\",\"path\":\"revenge.d64:revenge fixed\",\"name\":\"packed\"}" >/dev/null

# Past the decruncher. `SYS 2061` is the BASIC stub's entry; the loader expands
# itself over the packed data in place and hands control on, and static analysis
# of the disk stops at 141 instructions without this.
c add_scenario "{\"project\":\"$name\",\"name\":\"decrunch\",
  \"description\":\"Run the loader until it hands control on, and keep what it expanded.\",
  \"steps\":[{\"kind\":\"start\",\"at\":\"\$080D\"},
             {\"kind\":\"run\",\"leaves\":true,\"maxInstructions\":20000000},
             {\"kind\":\"capture\",\"what\":\"ram\",\"from\":\"\$0801\",\"to\":\"\$C11F\",\"name\":\"runtime.prg\"}]}" \
  | j '["scenario"]' > "$run/decrunch.id"
c run_scenario "{\"project\":\"$name\",\"id\":\"$(cat "$run/decrunch.id")\"}" > "$run/decrunch.json"

c add_byte_layer "{\"project\":\"$name\",\"type\":\"prg\",\"path\":\"runtime.prg\",\"name\":\"runtime\"}" >/dev/null

# Two phases of the program's life. A target list is a history: the file as the
# disk loads it, and the image it expands into.
layers=$(c list_targets "{\"project\":\"$name\"}")
packed=$(printf '%s' "$layers" | j '["layers"][[l["name"] for l in json.load(open("/dev/null"))] if False else 0]["id"]' 2>/dev/null || true)
packed=$(printf '%s' "$layers" | python3 -c 'import sys,json;print([l["id"] for l in json.load(sys.stdin)["layers"] if l["name"]=="packed"][0])')
runtime=$(printf '%s' "$layers" | python3 -c 'import sys,json;print([l["id"] for l in json.load(sys.stdin)["layers"] if l["name"]=="runtime"][0])')

c add_target "{\"project\":\"$name\",\"name\":\"loader\",\"order\":1,
  \"description\":\"The file as the disk loads it, still packed.\",
  \"entryPoints\":[\"\$080D\"],
  \"layers\":[{\"layer\":\"$packed\"}]}" >/dev/null

# Where the decrunched program actually begins, which nothing derives: the
# loader's own BASIC stub is still at $0801 in the expanded image and points at
# bytes the decruncher overwrote. Experiment 7 established these two by hand and
# they are given rather than re-found, because this run is not about that.
c add_target "{\"project\":\"$name\",\"name\":\"runtime\",\"order\":2,
  \"description\":\"The image the loader expands into, which is the program that runs.\",
  \"entryPoints\":[\"\$C065\",\"\$8A3C\"],
  \"layers\":[{\"layer\":\"$runtime\"}]}" >/dev/null

c describe_project "{\"project\":\"$name\",\"target\":\"runtime\"}" > "$run/seeded.json"
python3 - "$run/seeded.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
c = d.get("counts", {})
print(f"  runtime target: {c.get('instructions','?')} instructions decoded, "
      f"{c.get('namedByHand','?')} names by hand", file=sys.stderr)
PY

cat <<EOF

$name is up on port $port, prepared to the runtime image.

  database    $run/$name.re64db
  transcript  $run/$name.mcp.jsonl
  server      pid $(cat "$run/server.pid"), log $run/server.log
  watch       http://127.0.0.1:$port/?project=$name

Three sessions, no contact except the project's own chat:

  reader one   RE64_USER=one   RE64_SESSION=one    paste brief-reader.md
  reader two   RE64_USER=two   RE64_SESSION=two    paste brief-reader.md
  editor       RE64_USER=ed    RE64_SESSION=ed     paste brief-editor.md

Stop:  kill \$(cat "$run/server.pid")
EOF
