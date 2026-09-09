#!/usr/bin/env bash
#
# Stand up experiment 11: one reviewer over work three earlier runs left behind.
#
# **The first run that starts from something.** Every experiment before this one
# began with an empty project, so all of them measured the first hour and none
# could measure whether an agent can build on somebody else's work — or
# contradict it. The silver image is 981 objects from runs 7, 9 and 10 under
# nine authors, imported faithfully and reviewed by nobody.
#
# It is built rather than copied, because `camels.re64` names a `runtime.prg`
# that exists on no disk: the decrunched image is produced by running the loader,
# which is the whole reason the machine model exists. `build.mjs` does that and
# takes about twenty seconds.
#
# Usage:  ./setup.sh [run-directory] [port] [project-name]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
run="${1:-$here/run}"
port="${2:-5194}"
name="${3:-camels}"

[ -f "$repo/dist/server/index.js" ] || { echo "Building..." >&2; (cd "$repo" && npm run build >/dev/null); }

if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $port is already in use. ./teardown.sh --all shows what is up." >&2; exit 1
fi

rm -rf "$run"; mkdir -p "$run"
echo "{ \"name\": \"$name\", \"layers\": [] }" > "$run/$name.re64"
node "$repo/experiments/import.mjs" "$run/$name.re64" >/dev/null

nohup node "$repo/dist/server/index.js" "$run/$name.re64db" --port "$port" \
  > "$run/server.log" 2>&1 &
echo $! > "$run/server.pid"
sleep 2
curl -sf "http://127.0.0.1:$port/api/projects" >/dev/null || {
  echo "The server did not come up. See $run/server.log" >&2; exit 1; }

echo "Building the silver image..."
node "$repo/assets/mutant-camels/build.mjs" --port "$port" --project "$name" \
  --out "$run/before.re64" | sed 's/^/  /'

# **The before-state, so the delta is a measurement and not an impression.**
# Snapshotted rather than recomputed at the end, because the run may change what
# these tools report and a number taken afterwards would be the wrong number.
c() { RE64_PORT="$port" RE64_USER=setup RE64_SESSION=setup "$repo/experiments/mcp-call.sh" "$@"; }
c describe_project "{\"project\":\"$name\",\"target\":\"runtime\"}" > "$run/before-describe.json"
c disagreements    "{\"project\":\"$name\",\"target\":\"runtime\"}" > "$run/before-disagreements.json"
c find_undecoded   "{\"project\":\"$name\",\"target\":\"runtime\"}" > "$run/before-undecoded.json" 2>/dev/null || true

python3 - "$run" <<'PY'
import json, sys, collections
run = sys.argv[1]
d = json.load(open(f"{run}/before-describe.json"))
g = json.load(open(f"{run}/before-disagreements.json"))
h = d.get("hygiene", [])
p = json.load(open(f"{run}/before.re64"))
names = collections.defaultdict(list)
for c in p.get("claims", []):
    if c.get("name"): names[c["at"]].append(c["name"])
summary = {
    "claims": len(p.get("claims", [])),
    "evidence": len(p.get("evidence", [])),
    "types": len(p.get("types", [])),
    "constants": len(p.get("constants", [])),
    "comments": sum(len(l.get("comments", [])) for l in p["layers"]),
    "hygiene": len(h),
    "hygieneByKind": dict(collections.Counter(f["kind"] for f in h)),
    "disagreements": g.get("total"),
    "addressesWithTwoNames": sum(1 for v in names.values() if len(v) > 1),
    "instructions": d.get("counts", {}).get("instructions"),
}
json.dump(summary, open(f"{run}/before.json", "w"), indent=1)
for k, v in summary.items():
    print(f"  {k:24} {v}")
PY

cat <<EOF

$name is up on port $port, holding the silver image.

  database    $run/$name.re64db
  before      $run/before.json  (and before.re64, the whole document)
  transcript  $run/$name.mcp.jsonl
  watch       http://127.0.0.1:$port/?project=$name

One reviewer. Paste brief.md:

  RE64_USER=rev  RE64_SESSION=rev

When it stops:  ./measure.sh $run $port $name
Then:           ../teardown.sh $run
EOF
