if (nodes[0].zh !== '退出前的最后一次编辑') throw Error('Quit lost a pending edit');
await new Promise(resolve => setTimeout(resolve, 200));
return 'normal quit waits for the final native save';
