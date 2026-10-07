#!/bin/bash
# Instala KLIK Agent como LaunchAgent de macOS: se inicia solo al abrir sesión, sin Terminal, y se reinicia si se cae.
# No copia tu .env: el agente lo lee desde esta misma carpeta.
set -u
LABEL="com.klik.agent"
DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST="${KLIK_PLIST:-$HOME/Library/LaunchAgents/$LABEL.plist}"
DRY="${KLIK_DRY_RUN:-0}"
say() { printf '%s\n' "$*"; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

[ "$DRY" = "1" ] || [ "$(uname)" = "Darwin" ] || die "Esto solo funciona en macOS."

# 1) Carpeta protegida por macOS (Descargas/Documentos/Escritorio/iCloud): un proceso en segundo plano NO puede leerla sin permisos extra.
case "$DIR" in
  "$HOME/Downloads"*|"$HOME/Documents"*|"$HOME/Desktop"*|*"/Library/Mobile Documents/"*)
    if [ "${KLIK_ALLOW_PROTECTED:-0}" != "1" ]; then
      TARGET="$HOME/KLIK-files-4"
      say "⚠️  Esta carpeta está en una ubicación protegida por macOS:"
      say "    $DIR"
      say "   Un agente en segundo plano suele recibir 'Operation not permitted' ahí."
      say "   Recomendado: moverla a $TARGET (incluye tu .env; nada se copia ni se borra)."
      if [ -t 0 ] && [ ! -e "$TARGET" ]; then
        printf '¿Mover la carpeta ahora y continuar? [S/n] '; read -r ANS
        case "$ANS" in n|N|no|NO) say "Continúo SIN mover (puede fallar; ver README).";; *)
          mv "$DIR" "$TARGET" || die "No pude mover la carpeta."
          say "✅ Movida a $TARGET"; exec "$TARGET/install-agent.sh";;
        esac
      else
        say "   (No puedo preguntarte, o $TARGET ya existe.) Muévela tú: mv \"$DIR\" \"$TARGET\" y vuelve a ejecutar ./install-agent.sh"
        say "   Para instalar igualmente aquí: KLIK_ALLOW_PROTECTED=1 ./install-agent.sh"
        exit 1
      fi
    fi;;
esac

# 2) Node: ruta absoluta real (launchd no carga tu shell, así que no ve nvm/homebrew por PATH)
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node" $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1); do [ -x "$c" ] && NODE="$c" && break; done
fi
[ -n "$NODE" ] || die "No encuentro Node. Instálalo (https://nodejs.org) y vuelve a ejecutar."
NODE="$("$NODE" -p 'process.execPath')"
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$MAJOR" -ge 18 ] 2>/dev/null || die "Necesitas Node 18 o superior (tienes $("$NODE" -v))."
say "✅ Node: $NODE ($("$NODE" -v))"

# 3) Archivos y .env
[ -f "$DIR/klik-agent.js" ] && [ -f "$DIR/page-code.js" ] || die "Faltan klik-agent.js o page-code.js en $DIR"
[ -f "$DIR/.env" ] || die "No existe $DIR/.env. Copia .env.example a .env y rellénalo (KLIK_URL y KLIK_PIN)."
grep -Eq '^KLIK_URL=https?://' "$DIR/.env" || die "KLIK_URL falta o es inválida en .env"
grep -Eqi '^KLIK_URL=.*tu-app' "$DIR/.env" && die "KLIK_URL en .env todavía dice 'tu-app'."
grep -Eq '^KLIK_PIN=.+' "$DIR/.env" || die "KLIK_PIN está vacío en .env"
if [ ! -d "$DIR/node_modules/ws" ] && [ "$DRY" != "1" ]; then
  say "📦 Instalando dependencias (npm install)…"
  (cd "$DIR" && PATH="$(dirname "$NODE"):$PATH" npm install --no-audit --no-fund) || die "npm install falló."
fi
mkdir -p "$DIR/logs"; chmod +x "$DIR"/*.sh 2>/dev/null

# 4) plist (las rutas se detectan solas; no hay que editar nada)
esc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$(esc "$DIR")/run-agent.sh</string></array>
  <key>WorkingDirectory</key><string>$(esc "$DIR")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>KLIK_NODE</key><string>$(esc "$NODE")</string>
    <key>PATH</key><string>$(esc "$(dirname "$NODE")"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>StandardOutPath</key><string>$(esc "$DIR")/logs/launchd.log</string>
  <key>StandardErrorPath</key><string>$(esc "$DIR")/logs/launchd.log</string>
</dict>
</plist>
PLISTEOF
chmod 644 "$PLIST"
if [ "$DRY" = "1" ]; then say "(modo prueba) plist escrito en $PLIST"; exit 0; fi
plutil -lint "$PLIST" >/dev/null || die "El plist generado no es válido: $PLIST"
say "✅ LaunchAgent creado: $PLIST"

# 5) Avisar si hay un agente manual (npm run agent) corriendo: dos agentes a la vez se pisan
if pgrep -f "klik-agent.js" >/dev/null 2>&1; then
  say "⚠️  Hay un 'klik-agent.js' ya en marcha (¿Terminal con npm run agent?). Ciérralo con Ctrl+C: si no, habrá dos agentes."
fi

# 6) Cargar e iniciar
UIDN="$(id -u)"; TARGET="gui/$UIDN/$LABEL"
launchctl bootout "$TARGET" >/dev/null 2>&1
launchctl bootstrap "gui/$UIDN" "$PLIST" || die "launchctl no pudo cargar el agente."
launchctl enable "$TARGET" >/dev/null 2>&1
launchctl kickstart -k "$TARGET" >/dev/null 2>&1
say "🚀 Agente iniciado en segundo plano."
say ""
say "👀 MIRA LA PANTALLA: macOS puede mostrar un aviso '… quiere controlar Safari'. Pulsa ACEPTAR/Permitir."
say "   (Abre Safari con Discord Web ANTES, para que el aviso salga ahora.)"
say ""
for i in $(seq 1 15); do
  sleep 1
  if grep -q "Conectado a KLIK" "$DIR/logs/agent.log" 2>/dev/null; then say "🟢 Conectado a KLIK."; break; fi
done
"$DIR/status-agent.sh"
