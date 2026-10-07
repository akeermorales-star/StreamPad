# KLIK v0.3

Tablet → KLIK (Render) → WebSocket → Mac. Dos clientes en la Mac:
- `receiver.html` reproduce los sonidos (igual que antes).
- La extensión **KLIK Bridge** (Chrome/Chromium) mutea/desmutea Discord Web.

## Servidor (Render o local)
    npm install && npm start        # variables: PIN, PORT (Render la inyecta), DATA_DIR (opcional)
- Tablet:   https://TU-APP.onrender.com/?key=PIN
- Receptor: https://TU-APP.onrender.com/receiver?key=PIN

## KLIK Bridge (en la Mac)
1. Chrome → `chrome://extensions` → activa "Modo de desarrollador" → "Cargar descomprimida" → carpeta `klik-bridge/`.
2. Icono de la extensión → pega la URL de Render y el PIN → "Guardar y conectar". Debe decir "✅ Conectado a KLIK".
3. Abre `https://discord.com/channels/@me` en una pestaña (puede quedar en segundo plano) e inicia sesión.
4. Chrome → Ajustes → Rendimiento → "Ahorro de memoria": añade `discord.com` a los sitios que siempre permanecen activos.

## Cómo se confirma el estado
El botón de mute de Discord Web cambia su `aria-label` ("Mute"/"Unmute"). La extensión lo lee y, tras pulsar, lo vuelve a leer a los 500 ms.
- Cambió → `🔴 MUTEADO` / `🟢 ACTIVO` (confirmado).
- No se pudo leer → `🟢 LISTO` / `🟡 COMANDO ENVIADO` (sin estado confirmado).

## Calibración (no verificado por mí)
No pude abrir Discord para comprobar sus etiquetas reales. Si la tablet muestra "⚠️ SIN BOTÓN DE MUTE":
abre la consola de la pestaña de Discord (⌥⌘J), busca `[KLIK Bridge] No encuentro el botón…`, copia las etiquetas que lista
y añádelas a `LABEL_MUTE` / `LABEL_UNMUTE` en `klik-bridge/content.js`; recarga la extensión.

## Qué NO hace
No usa discord-rpc, tokens, contraseñas ni APIs de Discord; no lee mensajes; no envía teclas; no cambia de ventana.
