const assert = (ok, message) => { if (!ok) throw Error(message); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
await pause(250);
assert(AppLocale.language === 'en' && document.body.dataset.theme === 'glass', 'Preferences survive a process restart');
assert(nodes.length === 2, 'Words survive a process restart');
assert(nodes[0].zh === '宁静；内心安定。' && nodes[1].parent === nodes[0].id, 'Definitions and edges survive restart');
// Show date handling across midnight without altering the computer clock.
const realToday = localDay(); TODAY = '2000-01-01'; ensureToday();
assert(TODAY === realToday && dayData.has(realToday), 'Date rollover refreshes today');
enterDay(TODAY); selectNode(nodes[0].id); await pause(550);
// User text must stay text, including after re-rendering.
nodes[0].word = '<img src=x onerror=alert(1)>'; renderNodes();
assert(document.querySelector('.word-label').querySelector('img') === null, 'Recorded words are not HTML');
nodes[0].word = 'serenity'; renderNodes(); layout(false); await pause(100);
await AppStorage.flush();
assert(!window.__testErrors?.length, 'No runtime errors: '+JSON.stringify(window.__testErrors));
return 'process restart preserves records, notes, links and preferences; date rollover and HTML escaping';
