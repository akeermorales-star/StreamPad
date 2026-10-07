#!/bin/bash
LABEL="com.klik.agent"; TARGET="gui/$(id -u)/$LABEL"
if launchctl bootout "$TARGET" 2>/dev/null; then echo "🔴 KLIK Agent detenido."; echo "   Volverá a iniciarse al abrir sesión de nuevo, o con ./start-agent.sh"
else echo "El agente no estaba en marcha."; fi
