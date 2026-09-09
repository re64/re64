#!/usr/bin/env bash
#
# What the reviewer changed, against what it started from.
#
#   ./measure.sh [run-directory] [port] [project-name]
#
# **The delta is the point of this experiment**, and it is the first one that has
# had a before to compare with — every earlier run started from an empty project,
# so "what changed" was the same question as "what happened".
#
# Read the counts and the log together. Where the reviewer's report and this
# disagree, this wins: an agent is an unreliable narrator of its own work, and
# the churn question in particular — did it teach a reader anything, or did it
# rename five hundred things — is one only the log can answer.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
run="${1:-$here/run}"
port="${2:-5194}"
name="${3:-camels}"

c() { RE64_PORT="$port" RE64_USER=measure RE64_SESSION=measure "$repo/experiments/mcp-call.sh" "$@"; }
c export_project   "{\"project\":\"$name\"}" > "$run/after-export.json"
c describe_project "{\"project\":\"$name\",\"target\":\"runtime\"}" > "$run/after-describe.json"
c disagreements    "{\"project\":\"$name\",\"target\":\"runtime\"}" > "$run/after-disagreements.json"

python3 - "$run" <<'PY'
import json, sys, collections
run = sys.argv[1]
before = json.load(open(f"{run}/before.json"))
after_doc = json.loads(json.load(open(f"{run}/after-export.json"))["text"])
d = json.load(open(f"{run}/after-describe.json"))
g = json.load(open(f"{run}/after-disagreements.json"))
h = d.get("hygiene", [])

names = collections.defaultdict(list)
for c in after_doc.get("claims", []):
    if c.get("name"): names[c["at"]].append(c["name"])

after = {
    "claims": len(after_doc.get("claims", [])),
    "evidence": len(after_doc.get("evidence", [])),
    "types": len(after_doc.get("types", [])),
    "constants": len(after_doc.get("constants", [])),
    "comments": sum(len(l.get("comments", [])) for l in after_doc["layers"]),
    "hygiene": len(h),
    "hygieneByKind": dict(collections.Counter(f["kind"] for f in h)),
    "disagreements": g.get("total"),
    "addressesWithTwoNames": sum(1 for v in names.values() if len(v) > 1),
    "instructions": d.get("counts", {}).get("instructions"),
}

print("what the document holds\n")
print(f"  {'':24}{'before':>9}{'after':>9}{'delta':>9}")
for k in ["claims","evidence","types","constants","comments","instructions",
          "hygiene","disagreements","addressesWithTwoNames"]:
    b, a = before.get(k), after.get(k)
    if isinstance(b, int) and isinstance(a, int):
        print(f"  {k:24}{b:>9}{a:>9}{a-b:>+9}")

print("\nhygiene by kind")
kinds = set(before.get("hygieneByKind", {})) | set(after.get("hygieneByKind", {}))
for k in sorted(kinds):
    b = before.get("hygieneByKind", {}).get(k, 0)
    a = after.get("hygieneByKind", {}).get(k, 0)
    if b != a or a: print(f"  {k:34}{b:>6}{a:>6}{a-b:>+6}")
json.dump(after, open(f"{run}/after.json","w"), indent=1)
PY

echo
python3 - "$run" "$name" <<'PY'
import json, sys, collections, os
run, name = sys.argv[1], sys.argv[2]
path = f"{run}/{name}.mcp.jsonl"
if not os.path.exists(path):
    print("no transcript"); raise SystemExit
rows = [json.loads(l) for l in open(path) if l.strip()]
mine = [r for r in rows if r.get("caller") == "rev" and "tool" in r]
if not mine:
    print("the reviewer made no calls"); raise SystemExit

EDIT = {"edit_claim","edit_comment","edit_type","edit_constant","remove_claim","remove_comment",
        "set_primary_label","bind_name","unbind_name","reorder_comments","remove_type"}
ADD  = {"add_claim","add_claims","add_comment","add_comments","add_type","add_constant",
        "bind_constants","add_evidence","add_scenario","mark_function","add_label"}
READ = {t for t in (r["tool"] for r in mine)} - EDIT - ADD

counts = collections.Counter(r["tool"] for r in mine)
edits = sum(n for t,n in counts.items() if t in EDIT)
adds  = sum(n for t,n in counts.items() if t in ADD)
reads = sum(n for t,n in counts.items() if t in READ)

print("what the reviewer did\n")
print(f"  {len(mine)} calls: {reads} reads, {adds} additions, {edits} revisions")
print(f"  {', '.join(f'{t}x{n}' for t,n in counts.most_common(12))}")
bad = [r['tool'] for r in mine if not r.get('ok')]
if bad: print(f"  refused: {dict(collections.Counter(bad))}")

print("\n  the churn question — a revision that teaches a reader nothing")
if adds + edits:
    share = edits / (adds + edits)
    print(f"    revisions are {share:.0%} of its writes")
    print("    (mostly revisions is not automatically churn; read findings.md for")
    print("     what each rename was meant to tell a reader, then judge)")

print("\n  mechanisms this run was watching, because two runs never used them")
for tool in ["add_constant","bind_constants","add_evidence","set_primary_label","add_type","where","preview"]:
    print(f"    {tool:20} {counts.get(tool, 0)}")
PY
