// KLIK Bridge — content script (solo discord.com)
// Hace UNA cosa: localizar el botón de mute del panel de usuario, leer su estado por su aria-label y pulsarlo.
// No lee mensajes, conversaciones, tokens ni credenciales. No toca nada más del DOM.

// Etiquetas EXACTAS (en minúsculas) del botón según el idioma de la interfaz de Discord.
// El aria-label describe la ACCIÓN: "Mute" => ahora mismo NO estás muteado; "Unmute" => estás muteado.
// Si tu Discord está en otro idioma, añade aquí las etiquetas (ver README, apartado Calibración).
const LABEL_MUTE   = ['mute', 'silenciar', 'silenciar micrófono', 'silenciar el micrófono'];
const LABEL_UNMUTE = ['unmute', 'dejar de silenciar', 'activar sonido', 'activar micrófono', 'activar el micrófono', 'quitar silencio'];

function findMuteButton() {
  const found = [];
  for (const b of document.querySelectorAll('button[aria-label]')) {
    const l = b.getAttribute('aria-label').trim().toLowerCase();
    const muted = LABEL_UNMUTE.includes(l) ? true : LABEL_MUTE.includes(l) ? false : null;
    if (muted === null) continue;
    const r = b.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue; // oculto
    found.push({ b, muted, top: r.top, left: r.left });
  }
  if (!found.length) return null;
  found.sort((x, y) => y.top - x.top || x.left - y.left); // el panel de usuario está abajo a la izquierda
  return found[0];
}

function read() {
  const f = findMuteButton();
  return { button: !!f, muted: f ? f.muted : null };
}

let warned = false;
function diagnose() {
  if (warned) return; warned = true;
  const labels = [...document.querySelectorAll('button[aria-label]')]
    .map((b) => b.getAttribute('aria-label')).filter((l) => /mute|silenc|micr|sonido/i.test(l));
  console.log('[KLIK Bridge] No encuentro el botón de mute. Etiquetas parecidas vistas:', labels);
}

function report() {
  const st = read();
  if (!st.button) diagnose(); else warned = false;
  try { chrome.runtime.sendMessage({ klik: 'status', ...st }); } catch { /* extensión recargada */ }
}

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m.klik === 'status') { reply(read()); return; }
  if (m.klik === 'toggle') {
    const f = findMuteButton();
    if (!f) { reply({ button: false }); return; }
    const before = f.muted;
    f.b.click();
    setTimeout(() => { // confirmación REAL: releer el botón tras el clic
      const after = read();
      reply({ button: true, before, muted: after.muted, confirmed: after.muted !== null && after.muted !== before });
    }, 500);
    return true; // respuesta asíncrona
  }
});

new MutationObserver(() => { clearTimeout(report.t); report.t = setTimeout(report, 150); })
  .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-label'] });
setInterval(report, 5000);
report();
