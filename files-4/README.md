# KLIK v0.4 — Discord Web en Safari

Tablet → KLIK (Render) → WebSocket → **KLIK Mac Agent** (en tu Mac) → Safari → Discord Web.
El soundboard (receiver.html) no ha cambiado.

## Cómo funciona (y qué NO hace)
El agente le pide a Safari, por AppleScript, que ejecute un script muy corto **solo en la pestaña de discord.com**:
busca el botón cuyo nombre accesible es *Mute/Unmute*, lee en qué estado está y lo pulsa. El script está en `mac-agent/page-code.js` (≈25 líneas, léelo si quieres).
- No cambia de app ni de pestaña, no envía teclas: **tu juego no se entera**. Safari no aparece en pantalla.
- No toca contraseña, cookies, tokens, mensajes ni la API de Discord. No cierra ni cambia tu sesión.
- El servidor NUNCA puede mandar código al agente: solo la orden fija `discord_toggle_mute`.

## ⚠️ Aviso de seguridad
Para que Safari acepte esto hay que activar "Permitir JavaScript desde Apple Events". Mientras esté activo, cualquier programa al que des permiso de Automatización sobre Safari puede ejecutar JavaScript en tus pestañas. Solo darás permiso a Terminal. Si dejas de hacer streams, desactívalo.

---------------------------------------------------------------
# GUÍA PASO A PASO (sin conocimientos técnicos)

## PASO 0 — Una sola vez: preparar Safari
1. Safari → menú **Safari** → **Ajustes…** → pestaña **Avanzado** → marca **"Mostrar funcionalidades para desarrolladores web"**.
2. Activa **"Permitir JavaScript desde Apple Events"** (en inglés: *Allow JavaScript from Apple Events*):
   - En macOS recientes: Safari → Ajustes… → pestaña **Desarrollo** (o *Developer*).
   - En macOS más antiguos: menú **Desarrollo** de la barra superior.
   Puede pedirte contraseña o Touch ID.

## PASO 1 — Abrir Discord Web
Abre `https://discord.com/app` en Safari (tu sesión ya está iniciada). Déjalo en su pestaña, aunque quede en segundo plano.

## PASO 2 — Instalar Node.js (una sola vez)
Abre **Terminal** (⌘ + Espacio, escribe `Terminal`, Enter) y escribe `node -v`.
Si sale un número 18 o mayor (por ejemplo `v22.1.0`), sigue. Si no, instala la versión LTS desde https://nodejs.org y repite.

## PASO 3 — Entrar a la carpeta del agente
Descomprime el ZIP. En Terminal escribe `cd ` (con un espacio al final), **arrastra la carpeta `mac-agent` a la ventana de Terminal** y pulsa Enter.

## PASO 4 — Instalar
    npm install

## PASO 5 — Configurar (una sola vez)
    cp .env.example .env
    open -e .env
Se abre un editor. Escribe tu dirección de Render y tu PIN (sin comillas), guarda con ⌘ + S y ciérralo:

    KLIK_URL=https://tu-app.onrender.com
    KLIK_PIN=tu-pin

## PASO 6 — Arrancar
    npm start
Debes ver `🟢 Conectado a KLIK`. **Deja esta ventana de Terminal abierta** mientras hagas streams (si el Mac se duerme, el agente se detiene).

## PASO 7 — Dar permiso de Automatización (solo la primera vez)
macOS preguntará: **"Terminal quiere controlar Safari"** → pulsa **Permitir**.
Si no apareció o lo negaste:
**Ajustes del Sistema → Privacidad y seguridad → Automatización → Terminal → activa "Safari"**. Luego detén el agente (Ctrl + C) y vuelve a ejecutar `npm start`.
(No hace falta el permiso de Accesibilidad: el agente no envía teclas.)

## PASO 8 — Abrir el receptor y la tablet
En la Mac: `https://tu-app.onrender.com/receiver?key=TU_PIN` → pulsa "Activar audio".
En la tablet: `https://tu-app.onrender.com/?key=TU_PIN`.
Arriba debe decir **🟢 MAC CONECTADA** y el botón Discord, **🟢 LISTO** (o 🟢 ACTIVO / 🔴 MUTEADO si pudo leerlo).

## PASO 9 — Entrar a una llamada y probar
Entra a una llamada de voz en Discord Web y pulsa **🎙️ Discord** en la tablet.
Verás 🟡 CAMBIANDO… y luego el estado real (o "✓ COMANDO EJECUTADO" si no pudo confirmarlo).

---------------------------------------------------------------
## Estados del botón Discord
| Tablet | Significa |
|---|---|
| ⚫ MAC DESCONECTADA | `npm start` no está corriendo (o PIN mal) |
| ABRE SAFARI Y DISCORD / ABRE DISCORD EN SAFARI | Safari cerrado o sin pestaña de discord.com |
| ACTIVA JS EN SAFARI | Falta el PASO 0 (punto 2) |
| DA PERMISO A SAFARI | Falta el PASO 7 |
| ⚠️ SIN BOTÓN DE MUTE | Ver abajo |
| 🟢 LISTO | Todo listo, sin estado confirmado |
| 🔴 MUTEADO / 🟢 ACTIVO | Estado leído de verdad del botón de Discord |
| 🟡 CAMBIANDO… → ✓ COMANDO EJECUTADO | Pulsado; no se pudo confirmar el nuevo estado |

## Si dice "SIN BOTÓN DE MUTE" (calibración)
No he podido abrir Discord para comprobar los nombres reales del botón en tu idioma. En la ventana de Terminal verás:
`Etiquetas parecidas vistas: [ ... ]`. Copia el nombre del botón de micrófono y añádelo, en minúsculas, a `LABEL_MUTE` (cuando el botón dice "silenciar") o a `LABEL_UNMUTE` (cuando dice "dejar de silenciar") en `mac-agent/page-code.js`. Reinicia con Ctrl + C y `npm start`.

## Limitaciones conocidas
- Safari puede "dormir" o descargar pestañas en segundo plano si el Mac va justo de memoria. Si ves "ABRE DISCORD EN SAFARI", pulsa esa pestaña una vez.
- En pestañas en segundo plano Safari puede tardar ~1 s en actualizar la página; el agente espera hasta ~2 s antes de rendirse con la confirmación.
- Si Discord cambia su página y deja de etiquetar el botón así, habrá que ajustar las etiquetas.
- Esto automatiza la interfaz de Discord Web; los términos de Discord prohíben modificar su cliente. Solo se pulsa tu propio botón de mute, pero la decisión es tuya.

## Servidor (Render) — sin cambios de despliegue
`npm start` en la RAÍZ sigue arrancando el servidor. Variables: `PIN`, y opcionales `KLIK_AGENT_TOKEN`, `DATA_DIR`.
La carpeta `klik-bridge/` (extensión de Chrome) ya no es necesaria; puede borrarse.
