import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import RPC from 'discord-rpc';
import { fileURLToPath } from 'url';
import path from 'path';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, PIN = '1234', PORT = 3000 } = process.env;
const TOKEN_FILE = path.join(__dir, '.token.json');
const SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write'];
const DATA = path.join(__dir, 'data');
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
app.use(express.static(path.join(__dir, 'public')));
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
const state = { discord: { connected: false, muted: null }, tablets: 0, receivers: 0, audioReady: false, last: null };
const broadcast = () => {
  const open = allClients().filter((c) => c.readyState === 1);
  state.tablets = open.filter((c) => c.role === 'controller').length;
  const rx = open.filter((c) => c.role === 'receiver');
  state.receivers = rx.length;
  state.audioReady = rx.some((c) => c.audioReady);
  send(open, { type: 'state', state });
};

// ---- Discord (RPC local por IPC) ----
let rpc = null;
async function connectDiscord() {
  rpc = new RPC.Client({ transport: 'ipc' });
  rpc.on('disconnected', () => {
    state.discord = { connected: false, muted: null };
    broadcast();
    setTimeout(connectDiscord, 5000);
  });
  rpc.on('ready', async () => {
    const v = await rpc.getVoiceSettings();
    state.discord = { connected: true, muted: !!v.mute };
    broadcast();
    rpc.subscribe('VOICE_SETTINGS_UPDATE', () => {});
  });
  rpc.on('VOICE_SETTINGS_UPDATE', (v) => { state.discord.muted = !!v.mute; broadcast(); });
  try {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch {}
    await rpc.login({
      clientId: DISCORD_CLIENT_ID, clientSecret: DISCORD_CLIENT_SECRET,
      redirectUri: 'http://localhost', scopes: SCOPES,
      ...(saved.accessToken ? { accessToken: saved.accessToken } : {}),
    });
    if (rpc.accessToken) fs.writeFileSync(TOKEN_FILE, JSON.stringify({ accessToken: rpc.accessToken }));
  } catch (e) {
    console.error('Discord no disponible:', e.message);
    try { fs.unlinkSync(TOKEN_FILE); } catch {}
    setTimeout(connectDiscord, 5000);
  }
}

// ---- Acciones (llegan por WebSocket desde la tablet) ----
const actions = {
  async 'discord.toggleMute'() {
    if (!state.discord.connected) throw new Error('Discord no conectado');
    const v = await rpc.getVoiceSettings();
    await rpc.setVoiceSettings({ mute: !v.mute });
    state.discord.muted = !v.mute;
  },
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
  ws.role = u.searchParams.get('role') === 'receiver' ? 'receiver' : 'controller';
  ws.audioReady = false;
  ws.send(JSON.stringify({ type: 'config', config }));
  broadcast();
  ws.on('close', broadcast);
  ws.on('message', async (raw) => {
    try {
      const m = JSON.parse(raw);
      if (m.type === 'receiver.status' && ws.role === 'receiver') { ws.audioReady = !!m.audioReady; return broadcast(); }
      if (!actions[m.action]) throw new Error('Acción desconocida');
      await actions[m.action](m);
      broadcast();
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`MyDeck en http://0.0.0.0:${PORT}\n  Tablet:   /?key=${PIN}\n  Receptor: /receiver.html?key=${PIN}`));
connectDiscord();
