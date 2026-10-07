#!/bin/bash
LABEL="com.klik.agent"; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"; TARGET="gui/$(id -u)/$LABEL"
DIR="$(cd "$(dirname "$0")" && pwd)"; LOG="$DIR/logs/agent.log"
if [ ! -f "$PLIST" ]; then echo "KLIK Agent: ⚪ NO INSTALADO (usa ./install-agent.sh)"; exit 0; fi
INFO="$(launchctl print "$TARGET" 2>/dev/null)"
if [ -z "$INFO" ]; then echo "KLIK Agent: 🔴 DETENIDO (instalado pero no cargado; usa ./start-agent.sh)"; exit 0; fi
PID="$(printf '%s\n' "$INFO" | awk '/^[[:space:]]*pid = /{print $3; exit}')"
if [ -n "$PID" ]; then echo "KLIK Agent: 🟢 ACTIVO (PID $PID)"; else echo "KLIK Agent: 🔴 DETENIDO (cargado pero sin proceso; mira ./logs-agent.sh)"; fi
MINE="$(pgrep -P "${PID:-0}" 2>/dev/null | tr '\n' ' ')"
for P in $(pgrep -f "node.*klik-agent.js" 2>/dev/null); do
  case " $MINE " in *" $P "*) ;; *) echo "⚠️  Hay otro klik-agent.js en marcha (PID $P; ¿npm run agent en Terminal?). Ciérralo con Ctrl+C.";; esac
done
if [ -f "$LOG" ]; then echo "--- últimas líneas relevantes ---"; grep -E "Conectado|Desconectado|detectado|⚠️|❌|iniciando|terminó|ERROR" "$LOG" | tail -n 6; fi
