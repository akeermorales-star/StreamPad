// KLIK Mac Agent — controla el mute de Discord Web que YA está abierto en Safari (macOS).
// Safari → AppleScript/JXA "do JavaScript" sobre la pestaña de discord.com. No usa teclas, no cambia de app, no toca la sesión.
import 'dotenv/config';
import WebSocket from 'ws';
import { execFile } from 'node:child_process';
import { pageCode } from './page-code.js';

const { KLIK_URL, KLIK_PIN, KLIK_AGENT_TOKEN = '' } = process.env;
const POLL_MS = Number(process.env.KLIK_POLL_MS ?? 4000); // 0 = no leer el estado periódicamente
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.platform !== 'darwin') { console.error('❌ Este agente solo funciona en macOS (usa Safari + AppleScript).'); process.exit(1); }
if (!KLIK_URL || !KLIK_PIN) { console.error('❌ Falta KLIK_URL o KLIK_PIN. Copia .env.example a .env y rellénalo (ver README).'); process.exit(1); }
const base = new URL(KLIK_URL);
const WS_URL = `${base.protocol === 'https:' ? 'wss' : 'ws'}://${base.host}/?role=agent&key=${encodeURIComponent(KLIK_PIN)}${KLIK_AGENT_TOKEN ? '&token=' + encodeURIComponent(KLIK_AGENT_TOKEN) : ''}`;

// ---- Safari (JXA): recorre pestañas, ejecuta el JS SOLO en las que son de discord.com. No activa Safari ni cambia de pestaña. ----
const JXA = String.raw`
function run(argv) {
  var code = argv[0];
  var safari = Application('Safari');
  if (!safari.running()) return JSON.stringify({ reason: 'safari_closed' });
  var res = { reason: 'no_tab', tabs: 0 };
  var wins = safari.windows();
  for (var i = 0; i < wins.length; i++) {
    var tabs = wins[i].tabs();
    for (var j = 0; j < tabs.length; j++) {
      var url = '';
      try { url = tabs[j].url() || ''; } catch (e) {}
      if (!/^https:\/\/([a-z0-9-]+\.)?discord\.com\//.test(url)) continue;
      res.tabs++;
      var r = JSON.parse(safari.doJavaScript(code, { in: tabs[j] }));
      if (r.error) { res.reason = 'js_error'; continue; }
      if (r.button) { r.tabs = res.tabs; return JSON.stringify(r); }
      res.reason = 'no_button'; res.labels = r.labels;
    }
  }
  return JSON.stringify(res);
}`;

function osa(code) {
  return new Promise((resolve) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', JXA, code], { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = `${stderr || ''} ${err.message || ''}`;
        const reason = /-1743|not authorized|not allowed to send/i.test(msg) ? 'no_permission'
          : /Apple Events/i.test(msg) && /JavaScript/i.test(msg) ? 'js_disabled' : 'osa_error';
        return resolve({ reason, detail: msg.trim().slice(0, 300) });
      }
      try { resolve(JSON.parse(stdout.trim())); } catch { resolve({ reason: 'osa_error', detail: String(stdout).slice(0, 200) }); }
    });
  });
}
let chain = Promise.resolve(); // una llamada a Safari a la vez
const run = (cmd) => { const p = chain.then(() => osa(pageCode(cmd))); chain = p.catch(() => {}); return p; };

const EXPLAIN = {
  safari_closed: 'Safari no está abierto',
  no_tab: 'No hay ninguna pestaña de Discord (discord.com) abierta en Safari',
  no_button: 'No encuentro el botón de mute en Discord Web (revisa el README: "SIN BOTÓN DE MUTE")',
  js_disabled: 'Safari bloquea JavaScript desde Apple Events: actívalo en Safari > Ajustes > Desarrollo',
  no_permission: 'macOS no deja a Terminal controlar Safari: Ajustes del Sistema > Privacidad y seguridad > Automatización',
  js_error: 'Error al ejecutar el script en la pestaña de Discord',
  osa_error: 'Error al hablar con Safari',
};
const norm = (r) => r.button
  ? { tab: true, button: true, muted: typeof r.muted === 'boolean' ? r.muted : null, reason: null }
  : { tab: (r.tabs || 0) > 0, button: false, muted: null, reason: r.reason || 'no_button', labels: r.labels, detail: r.detail };

async function toggle() {
  const first = await run('toggle');
  if (!first.button) { const n = norm(first); return { success: false, reason: n.reason, error: EXPLAIN[n.reason] || EXPLAIN.osa_error }; }
  const before = first.muted; let after = null;
  for (let i = 0; i < 4; i++) { // Safari puede tardar en repintar una pestaña en segundo plano
    await sleep(500);
    const s = await run('status');
    if (s.button && typeof s.muted === 'boolean') { after = s.muted; if (after !== before) break; }
  }
  return { success: true, confirmed: after !== null && after !== before, muted: after };
}

// ---- Conexión con KLIK (Render) ----
let ws = null, lastSent = '', lastLog = '', pollTimer = null, pingTimer = null, lastRx = 0, retry = 1000;

async function poll() {
  if (!POLL_MS || ws?.readyState !== 1) return;
  const n = norm(await run('status'));
  const key = JSON.stringify([n.tab, n.button, n.muted, n.reason]);
  if (key !== lastLog) {
    lastLog = key;
    log(n.button ? `🎙️ Discord Web detectado — ${n.muted ? 'MUTEADO' : 'ACTIVO'}` : `⚠️ ${EXPLAIN[n.reason] || n.reason}`);
    if (n.reason === 'no_button' && n.labels) log('   Etiquetas parecidas vistas:', JSON.stringify(n.labels));
    if (n.detail) log('   Detalle:', n.detail);
  }
  if (key !== lastSent && ws?.readyState === 1) { lastSent = key; ws.send(JSON.stringify({ type: 'discord.status', tab: n.tab, button: n.button, muted: n.muted, reason: n.reason })); }
}

function connect() {
  ws = new WebSocket(WS_URL);
  ws.on('open', () => {
    retry = 1000; lastRx = Date.now(); lastSent = '';
    log('🟢 Conectado a KLIK:', base.host);
    if (!POLL_MS) ws.send(JSON.stringify({ type: 'discord.status', tab: true, button: true, muted: null, reason: null }));
    poll(); pollTimer = setInterval(poll, POLL_MS || 60000);
    pingTimer = setInterval(() => {
      if (Date.now() - lastRx > 70000) return ws.terminate(); // conexión muerta
      ws.readyState === 1 && ws.send(JSON.stringify({ type: 'bridge.ping' }));
    }, 20000);
  });
  ws.on('message', async (raw) => {
    lastRx = Date.now();
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type !== 'discord_toggle_mute') return;
    log('📲 Orden recibida: discord_toggle_mute');
    const r = await toggle().catch((e) => ({ success: false, error: e.message }));
    log(r.success ? (r.confirmed ? `✅ Hecho — ahora ${r.muted ? 'MUTEADO' : 'ACTIVO'}` : '✓ Comando ejecutado (no pude confirmar el estado)') : `❌ ${r.error}`);
    ws.readyState === 1 && ws.send(JSON.stringify({ type: 'discord_result', id: m.id, ...r }));
    poll();
  });
  ws.on('close', (code) => {
    clearInterval(pollTimer); clearInterval(pingTimer); ws = null;
    log(code === 4001 ? '❌ PIN incorrecto (revisa KLIK_PIN)' : code === 4003 ? '❌ KLIK_AGENT_TOKEN incorrecto' : '⚫ Desconectado. Reintentando…');
    setTimeout(connect, retry); retry = Math.min(retry * 2, 15000);
  });
  ws.on('error', (e) => log('Error de conexión:', e.message));
}

log('KLIK Mac Agent — Safari + Discord Web');
connect();
