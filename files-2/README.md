# MyDeck v0.2

Tablet (control) → WebSocket → agente en tu Mac/PC → el navegador *receptor* de esa PC reproduce el sonido.

## Arranque
    cp .env.example .env      # Client ID/Secret de Discord y un PIN
    npm install
    npm start
- Tablet:   http://IP-DE-LA-PC:3000/?key=PIN
- Receptor: http://localhost:3000/receiver.html?key=PIN  (en la PC; pulsa "Activar audio" una vez)

## Discord (una sola vez)
Developer Portal → tu app → OAuth2 (Client ID/Secret, redirect `http://localhost`) → App Testers: añade tu cuenta.
Discord de escritorio debe estar abierto; la primera vez pide autorizar.

## Datos
- `data/config.json`: botones, nombres, emojis, volúmenes, orden y volumen general.
- `data/sounds/`: los audios subidos. Persisten al recargar o reiniciar.
- El receptor guarda además una copia de los audios en su IndexedDB.
