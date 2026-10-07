#!/bin/bash
LABEL="com.klik.agent"; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"; TARGET="gui/$(id -u)/$LABEL"
[ -f "$PLIST" ] || { echo "No está instalado. Ejecuta primero: ./install-agent.sh"; exit 1; }
if ! launchctl print "$TARGET" >/dev/null 2>&1; then launchctl bootstrap "gui/$(id -u)" "$PLIST" || exit 1; fi
launchctl kickstart -k "$TARGET" && echo "🚀 KLIK Agent iniciado/reiniciado." && sleep 2 && "$(dirname "$0")/status-agent.sh"
