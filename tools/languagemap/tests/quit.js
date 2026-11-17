enterDay(TODAY); selectNode(nodes[0].id);
document.querySelector('#native-editor').textContent = '退出前的最后一次编辑';
document.querySelector('#native-editor').dispatchEvent(new Event('input'));
return 'TEST_QUIT';
