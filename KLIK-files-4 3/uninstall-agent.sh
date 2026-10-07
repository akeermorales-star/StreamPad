#!/bin/bash
LABEL="com.klik.agent"; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"; TARGET="gui/$(id -u)/$LABEL"
launchctl bootout "$TARGET" 2>/dev/null
rm -f "$PLIST"
echo "🗑  Inicio automático desinstalado. Tus archivos, .env y logs NO se tocaron."
echo "   Para usar el agente a mano: npm run agent"
