#!/bin/bash
# Lo ejecuta launchd (no lo uses a mano). Arranca klik-agent.js, guarda los logs en logs/agent.log
# y los rota solos (~1 MB por archivo, se conserva logs/agent.log.1).
cd "$(dirname "$0")" || exit 1
mkdir -p logs
LOG="logs/agent.log"
MAX="${KLIK_LOG_MAX:-1048576}"
CHECK="${KLIK_LOG_CHECK:-60}"
stamp() { date '+%Y-%m-%d %H:%M:%S'; }
rotate() { if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt "$MAX" ]; then cp "$LOG" "$LOG.1" && : > "$LOG"; fi; }

rotate
NODE_BIN="${KLIK_NODE:-$(command -v node)}"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "=== $(stamp) ERROR: no encuentro Node ($NODE_BIN). Vuelve a ejecutar ./install-agent.sh ===" >> "$LOG"
  exit 1
fi
echo "=== $(stamp) KLIK Agent: iniciando (node: $NODE_BIN) ===" >> "$LOG"

"$NODE_BIN" klik-agent.js >> "$LOG" 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null; echo "=== $(stamp) KLIK Agent: detenido ===" >> "$LOG"; exit 0' TERM INT HUP

while kill -0 "$PID" 2>/dev/null; do
  sleep "$CHECK" & wait $!
  rotate
done
wait "$PID"; CODE=$?
echo "=== $(stamp) KLIK Agent: el proceso terminó (código $CODE); launchd lo reiniciará en unos segundos ===" >> "$LOG"
exit "$CODE"
