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
let config, freshStart = false;
try { config = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch { config = defaults(); freshStart = true; }
const saveCfg = () => { freshStart = false; fs.writeFileSync(CFG, JSON.stringify(config, null, 2)); cloudSaveConfig(); };
const fileExists = (s) => !!s.file && fs.existsSync(path.join(SND, s.file));
const missingSlots = () => (CLOUD ? [] : config.slots.filter((s) => s.file && !fileExists(s)));
const slotOf = (id) => config.slots.find((s) => s.id === id);
const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0));
const ALLOWED = ['.mp3', '.wav', '.m4a'];
const MIME = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };

// ---- Almacenamiento PERMANENTE opcional (Supabase Storage) ----
// Render Free borra el disco en cada deploy/reinicio. Si defines SUPABASE_URL y SUPABASE_SERVICE_KEY en Render,
// los sonidos y la configuración se guardan también en la nube y se restauran solos al arrancar.
// Sin esas variables todo funciona como antes (solo disco local).
const SB_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const SB_BUCKET = (process.env.SUPABASE_BUCKET || 'klik').trim();
const CLOUD = !!(SB_URL && SB_KEY);
let cloudLoaded = !CLOUD, cloudError = null; // cloudLoaded: ya se leyó la config de la nube (o no se usa nube)
const sbFetch = (method, route, { body, type, json, timeout = 15000 } = {}) => fetch(`${SB_URL}/storage/v1/${route}`, {
  method, signal: AbortSignal.timeout(timeout), body: json ? JSON.stringify(json) : body,
  headers: { apikey: SB_KEY, ...(SB_KEY.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + SB_KEY }), ...(json ? { 'Content-Type': 'application/json' } : {}), ...(type ? { 'Content-Type': type, 'x-upsert': 'true' } : {}) },
});
async function cloudPut(p, buf, type) {
  const r = await sbFetch('POST', `object/${SB_BUCKET}/${p}`, { body: buf, type, timeout: 60000 });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 160)}`);
}
async function cloudGet(p) { // devuelve Buffer, o null si el objeto no existe
  const r = await sbFetch('GET', `object/authenticated/${SB_BUCKET}/${p}`, { timeout: 60000 });
  if (r.ok) return Buffer.from(await r.arrayBuffer());
  const t = await r.text();
  if (r.status === 404 || /not[_ ]?found/i.test(t)) return null;
  throw new Error(`Supabase ${r.status}: ${t.slice(0, 160)}`);
}
const cloudDel = (p) => sbFetch('DELETE', `object/${SB_BUCKET}/${p}`).then((r) => { if (!r.ok) console.warn(`[cloud] no se pudo borrar ${p}: HTTP ${r.status}`); });
async function cloudEnsureBucket() {
  const r = await sbFetch('POST', 'bucket', { json: { id: SB_BUCKET, name: SB_BUCKET, public: false } });
  if (r.ok) return console.log(`[cloud] bucket "${SB_BUCKET}" creado`);
  const t = await r.text();
  if (r.status === 409 || /already exists|duplicate/i.test(t)) return; // ya existía: perfecto
  throw new Error(`no se pudo crear/comprobar el bucket "${SB_BUCKET}": HTTP ${r.status} ${t.slice(0, 160)}`);
}
let cfgChain = Promise.resolve(); // guardados de config en orden, uno a uno
function cloudSaveConfig() {
  if (!CLOUD || !cloudLoaded) return;
  const snap = Buffer.from(JSON.stringify(config, null, 2));
  cfgChain = cfgChain.then(() => cloudPut('config.json', snap, 'application/json'))
    .then(() => { cloudError = null; console.log('[cloud] config.json guardada'); }, (e) => { cloudError = e.message; console.error('[cloud] ERROR guardando config.json:', e.message); });
}
async function cloudLoad() {
  const buf = await cloudGet('config.json');
  if (buf) {
    const c = JSON.parse(buf.toString('utf8'));
    if (!Array.isArray(c.slots)) throw new Error('config.json de la nube con formato inválido');
    config = c; freshStart = false;
    fs.writeFileSync(CFG, JSON.stringify(config, null, 2));
    console.log(`[cloud] configuración restaurada desde la nube (${config.slots.filter((x) => x.file).length} sonidos)`);
  } else {
    console.log('[cloud] la nube está vacía (primer uso)');
    for (const x of config.slots) { // si hay sonidos locales de antes, súbelos una vez
      const fp = x.file && path.join(SND, x.file);
      if (fp && fs.existsSync(fp)) await cloudPut('sounds/' + x.file, fs.readFileSync(fp), MIME[path.extname(x.file)] || 'application/octet-stream');
    }
    cloudLoaded = true; cloudSaveConfig();
  }
  cloudLoaded = true; cloudError = null;
}
const restoring = new Map();
async function ensureLocal(s) { // ¿existe el archivo del slot? si no está en disco, intenta traerlo de la nube
  if (!s?.file) return false;
  const fp = path.join(SND, s.file);
  if (fs.existsSync(fp)) return true;
  if (!CLOUD || !cloudLoaded) return false;
  if (!restoring.has(s.file)) restoring.set(s.file, (async () => {
    const buf = await cloudGet('sounds/' + s.file);
    if (!buf) return false;
    fs.writeFileSync(fp, buf); console.log(`[cloud] sonido restaurado: ${s.file} (${buf.length} bytes)`); return true;
  })().finally(() => restoring.delete(s.file)));
  return restoring.get(s.file);
}

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
const BUILD = 'sonidos-v3';
app.get('/version', (_q, r) => r.json({ build: BUILD, cloud: CLOUD, cloudLoaded, agentConnected: !!allClients().find((c) => c.role === 'agent' && c.readyState === 1) }));
app.get('/', page('index.html'));
app.get('/index.html', page('index.html'));
app.get('/receiver', page('receiver.html'));
app.get('/receiver.html', page('receiver.html'));
app.get('/style.css', page('style.css'));
app.use(express.static(PUBLIC)); // cualquier otro estático (JS, imágenes, etc.) dentro de /public
app.use(express.json());
const auth = (req, res, next) => ((req.get('x-key') || req.query.key) === PIN ? next() : res.status(401).json({ error: 'PIN incorrecto' }));
const changed = () => { saveCfg(); send(allClients(), { type: 'config', config }); };

app.use('/sounds', auth, async (q, _r, next) => {
  try { const f = decodeURIComponent(q.path.slice(1)); const s = config.slots.find((x) => x.file === f); if (s) await ensureLocal(s); }
  catch (e) { console.error('[cloud] restaurando sonido:', e.message); }
  next();
});
app.use('/sounds', auth, express.static(SND));
app.use('/sounds', (q, r) => { console.warn(`[sounds] 404 ${q.path} — el archivo no existe en el servidor`); r.status(404).json({ error: 'Archivo de sonido no encontrado' }); });
app.use('/api', (q, r, next) => (q.method === 'GET' || cloudLoaded ? next() : r.status(503).json({ error: 'El almacenamiento en la nube aún no está listo. Espera unos segundos y reintenta' })));
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
app.post('/api/upload/:id', auth, express.raw({ type: () => true, limit: '25mb' }), async (q, r) => {
  const s = slotOf(q.params.id); if (!s) return r.status(404).json({ error: 'Botón inexistente' });
  const orig = decodeURIComponent(q.get('x-filename') || '');
  const ext = path.extname(orig).toLowerCase();
  if (!ALLOWED.includes(ext)) return r.status(400).json({ error: 'Solo MP3, WAV o M4A' });
  if (!Buffer.isBuffer(q.body) || !q.body.length) return r.status(400).json({ error: 'Archivo vacío' });
  const newFile = `${s.id}-${Date.now()}${ext}`;
  if (CLOUD) { // si la nube falla, avisamos: no queremos sonidos que parecen guardados pero se perderán
    try { await cloudPut('sounds/' + newFile, q.body, MIME[ext]); }
    catch (e) { console.error('[upload] fallo guardando en la nube:', e.message); return r.status(502).json({ error: 'No se pudo guardar en la nube: ' + e.message }); }
  }
  const old = s.file;
  if (old) { fs.rmSync(path.join(SND, old), { force: true }); if (CLOUD) cloudDel('sounds/' + old).catch((e) => console.warn('[cloud]', e.message)); }
  s.file = newFile; s.orig = orig;
  fs.writeFileSync(path.join(SND, s.file), q.body);
  console.log(`[upload] ${s.id} ${s.file} (${q.body.length} bytes)${CLOUD ? ' + nube' : ' (solo disco local)'}`);
  changed(); r.json(s);
});
app.delete('/api/slot/:id', auth, (q, r) => {
  const s = slotOf(q.params.id); if (!s) return r.status(404).json({ error: 'Botón inexistente' });
  if (s.file) { fs.rmSync(path.join(SND, s.file), { force: true }); if (CLOUD) cloudDel('sounds/' + s.file).catch((e) => console.warn('[cloud]', e.message)); }
  Object.assign(s, { name: '', emoji: '🔊', volume: 100, file: null, orig: null });
  changed(); r.json(s);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
server.on('upgrade', (req) => console.log('[upgrade]', req.url.replace(/key=[^&]*/, 'key=***').replace(/token=[^&]*/, 'token=***')));
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
  state.storage = { persistent: CLOUD || !!process.env.DATA_DIR, cloud: CLOUD, cloudReady: cloudLoaded, cloudError, files: config.slots.filter((s) => s.file).length, missing: missingSlots().length };
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
  async 'sound.play'(m) {
    const s = slotOf(m.id);
    console.log(`[sound.play] slot=${m.id} file=${s?.file || '-'} receptores=${receivers().length} audioReady=${state.audioReady}`);
    if (!s?.file) throw new Error('Este botón no tiene sonido');
    let ok = false;
    try { ok = await ensureLocal(s); } catch (e) { console.error('[sound.play] error restaurando desde la nube:', e.message); throw new Error('No se pudo recuperar el sonido desde la nube: ' + e.message); }
    if (!ok) { console.error(`[sound.play] FALTA: ${s.file} (no está en disco${CLOUD ? ' ni en la nube' : '; Render lo borró al reiniciar'})`); throw new Error('El archivo de este sonido ya no existe en el servidor. Súbelo otra vez en ⚙️ Editar Deck.'); }
    const rx = receivers();
    if (!rx.length) throw new Error('No hay receptor: abre /receiver.html en la computadora');
    if (!state.audioReady) throw new Error('El receptor aún no tiene el audio activado');
    console.log(`[sound.play] → enviado a ${rx.length} receptor(es): ${s.file}`);
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
      if (m.type === 'receiver.played' && ws.role === 'receiver') return console.log(`[receiver] ✓ reprodujo ${m.file} (${m.ms} ms desde que llegó la orden)`);
      if (m.type === 'receiver.error' && ws.role === 'receiver') {
        console.error(`[receiver] ${m.where || ''}: ${m.message}`);
        return send(allClients().filter((c) => c.role === 'controller'), { type: 'error', message: 'PC: ' + String(m.message).slice(0, 160) });
      }
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
  console.log(`MyDeck escuchando en el puerto ${PORT} (build ${BUILD})`);
  console.log(`  index.html:    ${front('index.html') || 'NO ENCONTRADO'}`);
  console.log(`  receiver.html: ${front('receiver.html') || 'NO ENCONTRADO'}`);
  console.log(`  Tablet:   /?key=PIN   Receptor: /receiver?key=PIN`);
  console.log(`  Datos en: ${DATA} | DATA_DIR ${process.env.DATA_DIR ? 'definido' : 'NO definido'}`);
  console.log(`  Sonidos configurados: ${config.slots.filter((s) => s.file).length} | faltan en disco: ${missingSlots().length}${freshStart ? ' | config.json NO existía → arranque limpio' : ''}`);
  if (CLOUD) console.log(`  ☁️ Respaldo permanente: Supabase (bucket "${SB_BUCKET}")`);
  else if (!process.env.DATA_DIR) console.warn('  ⚠️ ALMACENAMIENTO EFÍMERO: en Render Free los sonidos subidos se borran en cada reinicio/deploy. Define SUPABASE_URL y SUPABASE_SERVICE_KEY (ver README).');
  if (CLOUD) cloudBoot();
});

// Lee la configuración de la nube al arrancar (reintenta hasta lograrlo). Mientras tanto los cambios se bloquean.
async function cloudBoot(n = 1) {
  try {
    await cloudEnsureBucket(); await cloudLoad();
    send(allClients(), { type: 'config', config }); broadcast();
  } catch (e) {
    cloudError = e.message;
    console.error(`[cloud] intento ${n} falló: ${e.message} — reintento en 15 s (cambios bloqueados hasta entonces)`);
    broadcast(); setTimeout(() => cloudBoot(n + 1), 15000);
  }
}
