#!/usr/bin/env bash
#
# Call one MCP tool and print what came back.
#
#   ./mcp-call.sh <tool> '<json arguments>'
#
# Deliberately dumb. It does not check that the tool exists, does not correct
# an argument name, and does not retry. A wrapper that helped would suppress
# exactly the signal these runs are for: a call to a tool that is not there is
# the clearest statement anyone can make about what the API is missing, and it
# only reaches the transcript if it is actually sent.
#
# Exists because an MCP client is connected when a session starts, so an agent
# spawned inside one cannot register a new server for itself. The endpoint,
# the tools and the transcript are the same either way; what this does not
# exercise is the client handshake.
set -uo pipefail

port="${RE64_PORT:-5164}"
user="${RE64_USER:-agent}"
session="${RE64_SESSION:-run-1}"

tool="${1:?usage: mcp-call.sh <tool> '<json arguments>'}"
args="${2:-{\}}"

curl -s -X POST "http://127.0.0.1:$port/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "x-re64-user: $user" \
  -H "x-re64-session: $session" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}" \
  | sed -n 's/^data: //p' \
  | node -e '
    let raw = "";
    process.stdin.on("data", (d) => (raw += d));
    process.stdin.on("end", () => {
      if (!raw.trim()) { console.log("(no reply)"); return; }
      let reply;
      try { reply = JSON.parse(raw); } catch { console.log(raw); return; }
      if (reply.error) { console.log("ERROR: " + reply.error.message); return; }
      const text = reply.result?.content?.[0]?.text ?? JSON.stringify(reply.result);
      if (reply.result?.isError) console.log("REFUSED: " + text);
      else console.log(text);
    });
  '
