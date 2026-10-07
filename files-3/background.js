// KLIK Bridge — service worker. Conecta con el WebSocket de KLIK (role=bridge) y reenvía órdenes a la pestaña de Discord Web.
let ws = null, lastSent = '', pingTimer = null;
const tabs = new Map(); // tabId -> {button, muted, ts}

const setStatus = (t) => chrome.storage.local.set({ status: t });

function summary() {
  const now = Date.now();
  for (const [id, s] of tabs) if (now - s.ts > 15000) tabs.delete(id);
  const arr = [...tabs.values()], withBtn = arr.find((s) => s.button);
  return { tab: arr.length > 0, button: !!withBtn, muted: withBtn ? withBtn.muted : null };
}
function push(force) {
  if (ws?.readyState !== 1) return;
  const sm = JSON.stringify(summary());
  if (!force && sm === lastSent) return;
  lastSent = sm;
  ws.send(JSON.stringify({ type: 'discord.status', ...JSON.parse(sm) }));
}

async function connect() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  const { url, pin } = await chrome.storage.local.get(['url', 'pin']);
  if (!url || !pin) return setStatus('Configura la URL y el PIN');
  let u; try { u = new URL(url); } catch { return setStatus('URL inválida'); }
  const sock = new WebSocket(`${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}/?key=${encodeURIComponent(pin)}&role=bridge`);
  ws = sock;
  sock.onopen = () => { setStatus('✅ Conectado a KLIK'); push(true); clearInterval(pingTimer); pingTimer = setInterval(() => sock.readyState === 1 && sock.send(JSON.stringify({ type: 'bridge.ping' })), 20000); };
  sock.onclose = (e) => { clearInterval(pingTimer); if (ws === sock) ws = null; lastSent = ''; setStatus(e.code === 4001 ? '❌ PIN incorrecto' : '⏳ Desconectado, reintentando…'); };
  sock.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'discord.cmd') {
      const r = await run(m.cmd).catch((e) => ({ ok: false, error: e.message }));
      sock.send(JSON.stringify({ type: 'discord.result', id: m.id, ...r }));
    }
  };
}

async function run(cmd) {
  if (cmd !== 'toggle') return { ok: false, error: 'Comando desconocido' };
  const list = await chrome.tabs.query({ url: 'https://discord.com/*' });
  if (!list.length) return { ok: false, error: 'No hay pestaña de Discord Web abierta' };
  for (const t of list) {
    const r = await chrome.tabs.sendMessage(t.id, { klik: 'toggle' }).catch(() => null);
    if (r?.button) return { ok: true, confirmed: !!r.confirmed, muted: r.muted };
  }
  return { ok: false, error: 'No encuentro el botón de mute en Discord Web' };
}

chrome.runtime.onMessage.addListener((m, sender) => {
  connect();
  if (m.klik === 'status' && sender.tab) { tabs.set(sender.tab.id, { button: m.button, muted: m.muted, ts: Date.now() }); push(); }
  if (m.klik === 'reconnect') { try { ws?.close(); } catch {} ws = null; connect(); }
});
chrome.tabs.onRemoved.addListener((id) => { tabs.delete(id); push(); });
chrome.alarms.create('klik-wake', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
