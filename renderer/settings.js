const $ = (id) => document.getElementById(id);

async function init() {
  const s = window.octotraySettings;
  const data = await s.load();

  $('baseUrl').value = data.baseUrl || '';
  $('apiKey').value = data.apiKey || '';
  $('pollSec').value = String(Math.round((data.pollIntervalMs || 5000) / 1000));
  $('openAtLogin').checked = !!data.openAtLogin;

  $('baseUrl').disabled = data.envLocked.url;
  $('apiKey').disabled = data.envLocked.key;
  $('pollSec').disabled = data.envLocked.poll;

  if (data.envLocked.url) {
    $('hintUrl').textContent = 'Locked: OCTOPRINT_URL is set in the environment.';
    $('hintUrl').classList.add('warn');
  }
  if (data.envLocked.key) {
    $('hintKey').textContent = 'Locked: OCTOPRINT_API_KEY is set in the environment.';
    $('hintKey').classList.add('warn');
  }
  if (data.envLocked.poll) {
    const h = $('hintPoll');
    h.textContent = 'Locked: OCTOPRINT_POLL_MS is set in the environment.';
    h.classList.add('warn');
  }

  $('savePath').textContent = `Saved to: ${data.savePath}`;

  $('btnCancel').addEventListener('click', () => s.close());

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('message');
    msg.textContent = '';
    msg.className = 'message';

    const res = await s.save({
      baseUrl: $('baseUrl').value.trim(),
      apiKey: $('apiKey').value.trim(),
      pollIntervalSec: Number($('pollSec').value),
      openAtLogin: $('openAtLogin').checked,
    });

    if (res.ok) {
      if (res.warning) {
        msg.textContent = res.warning;
        msg.classList.add('warn');
        setTimeout(() => s.close(), 5000);
      } else {
        msg.textContent = 'Saved.';
        msg.classList.add('ok');
        setTimeout(() => s.close(), 450);
      }
    } else {
      msg.textContent = res.error || 'Could not save.';
      msg.classList.add('err');
    }
  });
}

init();
