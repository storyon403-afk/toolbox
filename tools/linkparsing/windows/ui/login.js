'use strict';
const complete = document.getElementById('complete');
document.getElementById('cancel').onclick = () => window.loginControls.cancel();
complete.onclick = () => { complete.disabled = true; window.loginControls.complete(); };
window.loginControls.onStatus(status => {
  document.getElementById('status').textContent = status.message;
  complete.disabled = status.busy === true;
});
