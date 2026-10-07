// JavaScript que KLIK Mac Agent ejecuta DENTRO de la pestaña de Discord Web en Safari.
// Es lo ÚNICO que se inyecta. Hace tres cosas: (1) buscar el botón cuyo nombre accesible (aria-label)
// es Mute/Unmute, (2) leer en cuál de los dos está, (3) si cmd === 'toggle', pulsarlo.
// No toca cookies, localStorage, tokens, mensajes ni ninguna API de Discord.

// Etiquetas EXACTAS en minúsculas. El aria-label describe la ACCIÓN: "Mute" => ahora NO estás muteado; "Unmute" => estás muteado.
// Si tu Discord está en otro idioma, añade aquí las etiquetas (ver README, "Si dice SIN BOTÓN DE MUTE").
export const LABEL_MUTE = ['mute', 'silenciar', 'silenciar micrófono', 'silenciar el micrófono'];
export const LABEL_UNMUTE = ['unmute', 'dejar de silenciar', 'activar sonido', 'activar micrófono', 'activar el micrófono', 'quitar silencio'];

export const pageCode = (cmd) => `(function (cmd) {
  try {
    var MUTE = ${JSON.stringify(LABEL_MUTE)};
    var UNMUTE = ${JSON.stringify(LABEL_UNMUTE)};
    var found = [], seen = [];
    var bs = document.querySelectorAll('button[aria-label]');
    for (var i = 0; i < bs.length; i++) {
      var raw = bs[i].getAttribute('aria-label') || '';
      var l = raw.trim().toLowerCase();
      var m = UNMUTE.indexOf(l) >= 0 ? true : MUTE.indexOf(l) >= 0 ? false : null;
      if (m === null) { if (/mute|silenc|micr/i.test(raw) && seen.length < 12) seen.push(raw); continue; }
      found.push({ b: bs[i], muted: m, top: bs[i].getBoundingClientRect().top });
    }
    if (!found.length) return JSON.stringify({ button: false, labels: seen });
    found.sort(function (a, z) { return z.top - a.top; });
    if (cmd === 'toggle') found[0].b.click();
    return JSON.stringify({ button: true, muted: found[0].muted });
  } catch (e) { return JSON.stringify({ error: String(e) }); }
})(${JSON.stringify(cmd)})`;
