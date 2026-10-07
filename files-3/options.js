const $ = (id) => document.getElementById(id);
chrome.storage.local.get(['url', 'pin', 'status']).then((c) => { $('url').value = c.url || ''; $('pin').value = c.pin || ''; $('st').textContent = c.status || ''; });
chrome.storage.onChanged.addListener((ch) => { if (ch.status) $('st').textContent = ch.status.newValue; });
$('save').onclick = async () => {
  await chrome.storage.local.set({ url: $('url').value.trim(), pin: $('pin').value });
  chrome.runtime.sendMessage({ klik: 'reconnect' });
};
