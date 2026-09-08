#!/usr/bin/env bash
#
# Stop what a run left behind.
#
#   ./teardown.sh                     # the run in ./run, from an experiment directory
#   ./teardown.sh 10-relations/run    # a particular one, from here
#   ./teardown.sh --all               # every run under experiments/
#   ./teardown.sh --all --dry-run     # say what would be stopped, stop nothing
#
# **Written because a run outlived its experiment by a day and a half.** Every
# `setup.sh` starts a server with `nohup` and writes its pid, and nothing ever
# stopped one: nine stale `server.pid` files had accumulated, one of them still
# serving. Worse were the chat watchers — `while true` loops polling
# `read_messages` every few seconds, which are started by hand during a run and
# named in no file at all. Three of those had been spinning for 37 hours against
# a port nothing was listening on.
#
# So this finds both, and finds the second by *port* rather than by pid, since
# that is the only thing a watcher carries that says which run it belongs to.
#
# **One limit, stated because it is not obvious.** A watcher is recognised by
# `RE64_PORT=` appearing in its command line, which is where it lands when the
# assignment is written inside the loop — the usual shape. Started instead as
# `RE64_PORT=5192 ./mcp-call.sh …` from an interactive shell, the variable is in
# the *environment* and `ps` cannot see it, so nothing here will find it. Kill
# that one by hand.
#
# Nothing here deletes anything. The database, the transcript and the captures
# are the run's output and stay exactly where they are — this stops processes.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

dry=""
targets=()
all=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry="yes" ;;
    --all) all="yes" ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) targets+=("$arg") ;;
  esac
done

if [ -n "$all" ]; then
  # Every directory holding a pid file, which is what `setup.sh` leaves.
  while IFS= read -r pidfile; do targets+=("$(dirname "$pidfile")"); done \
    < <(find "$here" -name "server.pid" | sort)
elif [ ${#targets[@]} -eq 0 ]; then
  targets=("run")
fi

if [ ${#targets[@]} -eq 0 ]; then
  echo "Nothing to tear down." >&2
  exit 0
fi

stopped=0
skipped=0

# Send a signal and wait for the process to go, escalating only if it will not.
# A server is killed politely first so SQLite can checkpoint its write-ahead
# log; a watcher has nothing to flush but is treated the same way for one
# reason, which is that it costs a second and there is no case for being rough.
stop() {
  local pid="$1" what="$2"
  if ! ps -p "$pid" >/dev/null 2>&1; then
    return 1
  fi
  if [ -n "$dry" ]; then
    echo "    would stop  $pid  $what"
    return 0
  fi
  kill -TERM "$pid" 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    ps -p "$pid" >/dev/null 2>&1 || break
    sleep 1
  done
  if ps -p "$pid" >/dev/null 2>&1; then
    kill -KILL "$pid" 2>/dev/null
    sleep 1
    echo "    killed      $pid  $what (did not stop politely)"
  else
    echo "    stopped     $pid  $what"
  fi
  return 0
}

for target in "${targets[@]}"; do
  run="$target"
  [ -d "$run" ] || run="$here/$target"
  if [ ! -d "$run" ]; then
    echo "no such run directory: $target" >&2
    continue
  fi
  run="$(cd "$run" && pwd)"
  echo "${run#"$here"/}"

  # The port, which is what a watcher can be recognised by. Taken from the
  # server's own command line while it is up, and from the log it wrote once it
  # is not — a watcher routinely outlives the server, which is exactly the case
  # this has to handle.
  port=""
  pid=""
  if [ -f "$run/server.pid" ]; then
    pid="$(cat "$run/server.pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && ps -p "$pid" >/dev/null 2>&1; then
      port="$(ps -p "$pid" -o command= | grep -oE -- '--port +[0-9]+' | grep -oE '[0-9]+' | head -1)"
    fi
  fi
  if [ -z "$port" ] && [ -f "$run/server.log" ]; then
    port="$(grep -oE '127\.0\.0\.1:[0-9]+' "$run/server.log" | grep -oE '[0-9]+$' | head -1)"
  fi

  # The server named by the pid file.
  if [ -n "$pid" ]; then
    if stop "$pid" "server${port:+ on port $port}"; then
      stopped=$((stopped + 1))
    else
      echo "    already gone $pid  server (stale pid file)"
      skipped=$((skipped + 1))
    fi
  fi

  # A server on this run's database that the pid file does not know about —
  # a second `setup.sh` in the same directory overwrites the file and orphans
  # whatever the first one started.
  db="$(basename "$run")"
  while IFS= read -r other; do
    [ -z "$other" ] && continue
    [ "$other" = "$pid" ] && continue
    stop "$other" "server (not in the pid file)" && stopped=$((stopped + 1))
  done < <(pgrep -f "dist/server/index.js .*${run}/" 2>/dev/null || true)

  # The watchers, by port. Matched on `RE64_PORT=<port>` because that is what
  # `mcp-call.sh` reads and therefore what every hand-started loop carries.
  if [ -n "$port" ]; then
    while IFS= read -r watcher; do
      [ -z "$watcher" ] && continue
      who="$(ps -p "$watcher" -o command= 2>/dev/null | grep -oE 'RE64_USER=[A-Za-z0-9_-]+' | head -1)"
      stop "$watcher" "watcher${who:+ ${who#RE64_USER=}} on port $port" && stopped=$((stopped + 1))
    done < <(pgrep -f "RE64_PORT=$port" 2>/dev/null || true)
  fi
done

# **Anything left that no run directory accounts for.** The case that prompted
# this script: experiment 9's watchers outlived it by 37 hours, and its run
# directory had been renamed to `run1/` on archiving — taking the pid file with
# it — so a sweep keyed on pid files would have walked straight past them. A
# watcher is started by hand and belongs to no file, so the only honest way to
# find a stray one is to look for the shape rather than for a record of it.
if [ -n "$all" ]; then
  strays=0
  while IFS= read -r stray; do
    [ -z "$stray" ] && continue
    ps -p "$stray" >/dev/null 2>&1 || continue
    line="$(ps -p "$stray" -o command= 2>/dev/null)"
    who="$(printf '%s' "$line" | grep -oE 'RE64_USER=[A-Za-z0-9_-]+' | head -1)"
    at="$(printf '%s' "$line" | grep -oE 'RE64_PORT=[0-9]+' | head -1)"
    [ $strays -eq 0 ] && echo "unaccounted for"
    strays=$((strays + 1))
    stop "$stray" "watcher${who:+ ${who#RE64_USER=}}${at:+ on ${at#RE64_PORT=}}, no run directory claims it" \
      && stopped=$((stopped + 1))
  done < <(pgrep -f "RE64_PORT=" 2>/dev/null || true)

  while IFS= read -r stray; do
    [ -z "$stray" ] && continue
    ps -p "$stray" >/dev/null 2>&1 || continue
    [ $strays -eq 0 ] && echo "unaccounted for"
    strays=$((strays + 1))
    stop "$stray" "server, no run directory claims it" && stopped=$((stopped + 1))
  done < <(pgrep -f "dist/server/index\.js" 2>/dev/null || true)
fi

echo
if [ -n "$dry" ]; then
  echo "Dry run: nothing was stopped."
else
  echo "Stopped $stopped process(es); $skipped stale pid file(s) named nothing running."
  echo "Databases, transcripts and captures are untouched."
fi
