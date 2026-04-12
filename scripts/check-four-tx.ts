const response = await fetch('https://public-bsc.nownodes.io/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'eth_getTransactionReceipt',
    params: ['0xc11c8747037a99feafece6868b4dec8acb626ab33002fc0579e386a9bb4469bb'],
    id: 1
  })
});

const data = await response.json();
const logs = data.result.logs;

console.log('Total logs:', logs.length);
console.log('\nLooking for LiquidityAdded events (topic: 0xc18aa71171b358b706fe3dd345299685ba21a5316c66ffa9e319268b033c44b0)');

const liquidityLogs = logs.filter(l => l.topics[0] === '0xc18aa71171b358b706fe3dd345299685ba21a5316c66ffa9e319268b033c44b0');
console.log('Found', liquidityLogs.length, 'LiquidityAdded events');

liquidityLogs.forEach((l, i) => {
  console.log(`\nEvent ${i}:`);
  console.log('  Address:', l.address);
  console.log('  Topics:', l.topics);
  console.log('  Data:', l.data);

  // Parse topics
  if (l.topics.length > 1) {
    console.log('  Topic[1] (base token):', '0x' + l.topics[1].slice(26));
  }
  if (l.topics.length > 2) {
    console.log('  Topic[2] (quote token):', '0x' + l.topics[2].slice(26));
  }
});
