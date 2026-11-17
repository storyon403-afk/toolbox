await new Promise(resolve => setTimeout(resolve, 300));
if (nodes.length || document.querySelector('#empty-home').hidden) throw Error('First-run screen must be empty and actionable');
if (!window.__testErrors || window.__testErrors.length) throw Error(JSON.stringify(window.__testErrors));
await AppStorage.flush();
return 'first-run screen ready';
