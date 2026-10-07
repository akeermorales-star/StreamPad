#!/bin/bash
# ./logs-agent.sh        → últimas 60 líneas, y sigue en vivo (Ctrl+C para salir)
# ./logs-agent.sh --last → solo las últimas 60 líneas
DIR="$(cd "$(dirname "$0")" && pwd)"; LOG="$DIR/logs/agent.log"
[ -f "$LOG" ] || { echo "Aún no hay logs ($LOG)."; exit 0; }
[ "$1" = "--last" ] && exec tail -n 60 "$LOG"
exec tail -n 60 -f "$LOG"
