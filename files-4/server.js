import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const { PIN = '1234' } = process.env;
const AGENT_TOKEN = process.env.KLIK_AGENT_TOKEN || ''; // opcional: exige además un token al agente de la Mac
const PORT = Number(process.env.PORT) || 3000; // Render inyecta process.env.PORT
const DATA = process.env.DATA_DIR || path.join(__dir, 'data'); // en Render con disco persistente: DATA_DIR=/ruta/del/disco
const SND = path.join(DATA, 'sounds');
const CFG = path.join(DATA, 'config.json');
fs.mkdirSync(SND, { recursive: true });

// ---- Configuración persistente (disco del agente) ----
const defaults = () => ({
  master: 100,
  slots: Array.from({ length: 5 }, (_, i) => ({ id: 's' + (i + 1), name: '', emoji: '🔊', volume: 100, file: null, orig: null })),
});
let config;
try { config = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch { config = defaults(); }
const saveCfg = () => fs.writeFileSync(CFG, JSON.stringify(config, null, 2));
const slotOf = (id) => config.slots.find((s) => s.id === id);
const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0));
const ALLOWED = ['.mp3', '.wav', '.m4a'];

const app = express();
// ---- Frontend: ruta absoluta basada en el directorio del proyecto ----
// Busca primero en /public y, si no existe, en la raíz del proyecto (por si el repo se subió sin la carpeta).
const PUBLIC = path.join(__dir, 'public');
const FRONT_DIRS = [PUBLIC, __dir];
const front = (name) => FRONT_DIRS.map((d) => path.join(d, name)).find((f) => fs.existsSync(f));
const page = (name) => (_q, res) => {
  const f = front(name);
  if (!f) return res.status(500).type('text').send(`No se encontró ${name}.\nBuscado en:\n${FRONT_DIRS.join('\n')}`);
  res.sendFile(f);
};
app.get('/', page('index.html'));
app.get('/index.html', page('index.html'));
app.get('/receiver', page('receiver.html'));
app.get('/receiver.html', page('receiver.html'));
app.get('/style.css', page('style.css'));
app.use(express.static(PUBLIC)); // cualquier otro estático (JS, imágenes, etc.) dentro de /public
app.use(express.json());
const auth = (req, res, next) => ((req.get('x-key') || req.query.key) === PIN ? next() : res.status(401).json({ error: 'PIN incorrecto' }));
const changed = () => { saveCfg(); send(allClients(), { type: 'config', config }); };

app.use('/sounds', auth, express.static(SND));
app.get('/api/config', auth, (_q, r) => r.json(config));
app.put('/api/prefs', auth, (q, r) => { config.master = clamp(q.body.master); changed(); r.json(config); });
app.put('/api/order', auth, (q, r) => {
  const ids = q.body.order || [];
  if (ids.length !== config.slots.length || !ids.every(slotOf)) return r.status(400).json({ error: 'Orden inválido' });
  config.slots = ids.map(slotOf); changed(); r.json(config);
});
app.patch('/api/slot/:id', auth, (q, r) => {
  const s = slotOf(q.params.id); if (!s) return r.status(404).json({ error: 'Botón inexistente' });
  const b = q.body;
  if (typeof b.name === 'string') s.name = b.name.slice(0, 24);
  if (typeof b.emoji === 'string') s.emoji = [...b.emoji].slice(0, 2).join('') || '🔊';
  if (b.volume !== undefined) s.volume = clamp(b.volume);
  changed(); r.json(s);
});
app.post('/api/upload/:id', auth, express.raw({ type: () => true, limit: '25mb' }), (q, r) => {
  const s = slotOf(q.params.id); if (!s) return r.status(404).json({ error: 'Botón inexistente' });
  const orig = decodeURIComponent(q.get('x-filename') || '');
  const ext = path.extname(orig).toLowerCase();
  if (!ALLOWED.includes(ext)) return r.status(400).json({ error: 'Solo MP3, WAV o M4A' });
  if (!Buffer.isBuffer(q.body) || !q.body.length) return r.status(400).json({ error: 'Archivo vacío' });
  if (s.file) fs.rmSync(path.join(SND, s.file), { force: true });
  s.file = `${s.id}-${Date.now()}${ext}`; s.orig = orig;
  fs.writeFileSync(path.join(SND, s.file), q.body);
  changed(); r.json(s);
});
app.delete('/api/slot/:id', auth, (q, r) => {
  const s = slotOf(q.params.id); if (!s) return r.status(404).json({ error: 'Botón inexistente' });
  if (s.file) fs.rmSync(path.join(SND, s.file), { force: true });
  Object.assign(s, { name: '', emoji: '🔊', volume: 100, file: null, orig: null });
  changed(); r.json(s);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const allClients = () => [...wss.clients];
const send = (list, m) => { const s = JSON.stringify(m); list.forEach((c) => c.readyState === 1 && c.send(s)); };
const receivers = () => allClients().filter((c) => c.readyState === 1 && c.role === 'receiver');

// ---- Estado compartido ----
const state = {
  discord: { bridge: false, tab: false, button: false, connected: false, muted: null, busy: false, unconfirmed: false },
  tablets: 0, receivers: 0, audioReady: false, last: null,
};
let dcBusy = false, dcUnconfirmed = false, dcFlash = false;
const broadcast = () => {
  const open = allClients().filter((c) => c.readyState === 1);
  state.tablets = open.filter((c) => c.role === 'controller').length;
  const rx = open.filter((c) => c.role === 'receiver');
  state.receivers = rx.length;
  state.audioReady = rx.some((c) => c.audioReady);
  const br = open.find((c) => c.role === 'agent') || open.find((c) => c.role === 'bridge'); // agente de Mac (Safari) tiene prioridad
  const dc = br?.dc || {};
  state.discord = {
    bridge: !!br, tab: !!dc.tab, button: !!dc.button, connected: !!(br && dc.tab),
    muted: dc.button && typeof dc.muted === 'boolean' ? dc.muted : null,
    busy: dcBusy, unconfirmed: dcUnconfirmed, flash: dcFlash, mac: br?.role || null, reason: dc.reason || null,
  };
  send(open, { type: 'state', state });
};

// ---- Discord Web vía extensión "KLIK Bridge" (sin RPC, sin tokens, sin atajos de teclado) ----
// La extensión del navegador de la Mac se conecta a este WebSocket con role=bridge, recibe órdenes y reporta el estado real.
const pending = new Map();
let seq = 0;
const bridge = () => allClients().find((c) => c.readyState === 1 && c.role === 'agent') || allClients().find((c) => c.readyState === 1 && c.role === 'bridge');
function askBridge(cmd, timeout = 4000) {
  const b = bridge();
  if (!b) throw new Error('Mac desconectada: ni klik-agent ni KLIK Bridge están conectados');
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error('La extensión no respondió')); }, timeout);
    pending.set(id, { resolve, t });
    b.send(JSON.stringify(b.role === 'agent' ? { type: 'discord_toggle_mute', id } : { type: 'discord.cmd', id, cmd }));
  });
}
async function discordToggle() {
  if (dcBusy) throw new Error('Ya hay un cambio en curso');
  dcBusy = true; broadcast();
  try {
    const r = await askBridge('toggle', 9000);
    if (!r.ok) throw new Error(r.error || 'No se pudo cambiar el mute');
    dcUnconfirmed = !r.confirmed; // true = orden ejecutada pero sin confirmación real del estado
    if (!r.confirmed) { // "✓ COMANDO EJECUTADO" unos segundos y vuelve a LISTO
      dcFlash = true; clearTimeout(discordToggle.t);
      discordToggle.t = setTimeout(() => { dcFlash = false; dcUnconfirmed = false; broadcast(); }, 2500);
    } else dcFlash = false;
  } finally { dcBusy = false; }
}

// ---- Acciones (llegan por WebSocket desde la tablet) ----
const actions = {
  'discord.toggleMute': discordToggle,
  discord_toggle_mute: discordToggle,
  'sound.play'(m) {
    const s = slotOf(m.id);
    if (!s?.file) throw new Error('Este botón no tiene sonido');
    const rx = receivers();
    if (!rx.length) throw new Error('No hay receptor: abre /receiver.html en la computadora');
    if (!state.audioReady) throw new Error('El receptor aún no tiene el audio activado');
    send(rx, { type: 'play', id: s.id, file: s.file, volume: m.volume !== undefined ? clamp(m.volume) : s.volume, name: s.name, emoji: s.emoji });
    state.last = { emoji: s.emoji, name: s.name || '(sin nombre)', at: Date.now() };
  },
  'sound.stop'() {
    send(receivers(), { type: 'stop' });
    state.last = { emoji: '⏹', name: 'Sonidos detenidos', at: Date.now() };
  },
};

// ---- WebSocket ----
wss.on('connection', (ws, req) => {
  const u = new URL(req.url, 'http://x');
  if (u.searchParams.get('key') !== PIN) return ws.close(4001, 'PIN incorrecto');
  const role = u.searchParams.get('role');
  if (role === 'agent' && AGENT_TOKEN && u.searchParams.get('token') !== AGENT_TOKEN) return ws.close(4003, 'Token de agente incorrecto');
  ws.role = ['receiver', 'bridge', 'agent'].includes(role) ? role : 'controller';
  ws.audioReady = false;
  ws.send(JSON.stringify({ type: 'config', config }));
  broadcast();
  ws.on('close', broadcast);
  ws.on('message', async (raw) => {
    try {
      const m = JSON.parse(raw);
      if (m.type === 'receiver.status' && ws.role === 'receiver') { ws.audioReady = !!m.audioReady; return broadcast(); }
      if (ws.role === 'bridge' || ws.role === 'agent') {
        if (m.type === 'bridge.ping') return ws.send(JSON.stringify({ type: 'pong' }));
        if (m.type === 'discord.status') {
          ws.dc = { reason: m.reason || null, tab: !!m.tab, button: !!m.button, muted: typeof m.muted === 'boolean' ? m.muted : null };
          if (ws.dc.muted !== null) dcUnconfirmed = false;
          return broadcast();
        }
        if (m.type === 'discord.result' || m.type === 'discord_result') { const p = pending.get(m.id); if (p) { clearTimeout(p.t); pending.delete(m.id); p.resolve({ ...m, ok: m.ok ?? m.success }); } return; }
        return;
      }
      if (!actions[m.action]) throw new Error('Acción desconocida');
      await actions[m.action](m);
      broadcast();
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });
});

// Latido para que el proxy de Render no cierre WebSockets inactivos
setInterval(() => allClients().forEach((c) => c.readyState === 1 && c.ping()), 25000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MyDeck escuchando en el puerto ${PORT}`);
  console.log(`  index.html:    ${front('index.html') || 'NO ENCONTRADO'}`);
  console.log(`  receiver.html: ${front('receiver.html') || 'NO ENCONTRADO'}`);
  console.log(`  Tablet:   /?key=PIN   Receptor: /receiver?key=PIN`);
});
