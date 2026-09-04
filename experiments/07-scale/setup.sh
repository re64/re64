#!/usr/bin/env bash
#
# Stand up experiment 7: collaboration at scale.
#
# Every collaboration run so far has been on Gridrunner, which is 4KB. Two
# readers on a program that small collide by proximity — they are looking at the
# same routine because there is barely another one — so what those runs measured
# was crowding rather than working together. Revenge of the Mutant Camels is
# roughly ten times the size, which is the first program here big enough for
# three readers to be genuinely apart, and therefore the first that can show
# whether they coordinate when nothing makes them.
#
# One project, shared, decrunched and structurally complete: the layers, the
# targets and the entry points, and **no annotations at all**. Building it is
# experiment 5's task and was done; this one is about reading.
#
# The setup uses only the tools an agent has, so it is the same path a builder
# would take and reproduces from the disk image alone.
#
# Usage:  ./setup.sh [run-directory]   (default: ./run)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
run="${1:-$here/run}"
port="${RE64_PORT:-5172}"
call="$repo/experiments/mcp-call.sh"

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
cp "$repo/assets/mutant-camels/revenge-of-the-mutant-camels.d64" "$run/"

echo '{ "name": "camels", "layers": [] }' > "$run/camels.re64"
node "$repo/dist/cli/index.js" import "$run/camels.re64" >/dev/null

nohup node "$repo/dist/server/index.js" "$run/camels.re64db" \
  --port "$port" > "$run/server.log" 2>&1 &
echo $! > "$run/server.pid"

sleep 2
curl -sf "http://127.0.0.1:$port/api/projects" >/dev/null || {
  echo "The server did not come up. See $run/server.log" >&2; exit 1; }

# Everything below is the ordinary tool surface, as a builder would use it.
c() { RE64_PORT="$port" RE64_USER=setup RE64_SESSION=setup "$call" "$@"; }

echo "Uploading the disk image..." >&2
url=$(c prepare_upload '{"project":"camels","name":"revenge-of-the-mutant-camels.d64"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["url"])')
curl -sf -X PUT --data-binary "@$run/revenge-of-the-mutant-camels.d64" "$url" >/dev/null

echo "Laying the packed file down..." >&2
c add_byte_layer '{"project":"camels","type":"prg",
  "path":"revenge-of-the-mutant-camels.d64:revenge fixed","name":"packed"}' >/dev/null

echo "Running the loader (this decrunches ~1.8M instructions)..." >&2
c run_program '{"project":"camels","from":"$080D",
  "capture":{"name":"runtime.prg","from":"$0801","to":"$C11F"}}' > "$run/decrunch.json"
python3 - "$run/decrunch.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(f"  {d['instructions']} instructions, stopped {d['stoppedAt']} ({d['reason']})", file=sys.stderr)
print(f"  wrote {len(d.get('wrote', []))} ranges, largest {d['wrote'][0] if d.get('wrote') else '-'}", file=sys.stderr)
PY

echo "Laying the decrunched image over it..." >&2
c add_byte_layer '{"project":"camels","type":"prg","path":"runtime.prg","name":"runtime"}' >/dev/null

# Two views of the same addresses, and the entry points that belong to each.
# Entry points rather than labels: structural, and not an annotation anybody
# has to be given credit for.
c list_targets '{"project":"camels"}' > "$run/layers.json"
layer_id() {
  python3 -c 'import json,sys
want = sys.argv[1]
for l in json.load(open(sys.argv[2]))["layers"]:
    if l["name"] == want:
        print(l["id"]); break' "$1" "$run/layers.json"
}
packed=$(layer_id packed)
runtime=$(layer_id runtime)

c set_target "{\"project\":\"camels\",\"name\":\"loader\",\"layers\":[\"$packed\"],
  \"entryPoints\":[\"\$080D\"]}" >/dev/null
c set_target "{\"project\":\"camels\",\"name\":\"runtime\",\"layers\":[\"$runtime\"],
  \"entryPoints\":[\"\$C065\",\"\$8A3C\"]}" >/dev/null
c select_target '{"project":"camels","name":"runtime"}' >/dev/null

c describe_project '{"project":"camels"}' > "$run/seeded.json"
python3 - "$run/seeded.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
counts = d.get("counts", {})
print(f"  decoding {counts.get('instructions','?')} instructions; "
      f"labels {counts.get('labels','?')}, comments {counts.get('comments','?')}, "
      f"regions {counts.get('regions','?')}", file=sys.stderr)
PY

cat <<EOF

Experiment 7 is up, detached. One project, three readers, shared.

  project     camels   (decrunched, structurally complete, nothing annotated)
  database    $run/camels.re64db
  transcript  $run/camels.mcp.jsonl
  server      pid $(cat "$run/server.pid"), log $run/server.log
  watch       http://127.0.0.1:$port/?project=camels

Each reader calls the same project with its own identity and session:

  RE64_PORT=$port RE64_USER=reader-1 RE64_SESSION=reader-1 \\
    $call list_participants '{"project":"camels"}'

Stop the server:  kill \$(cat "$run/server.pid")
EOF
