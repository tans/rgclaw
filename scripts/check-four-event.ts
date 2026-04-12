import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';

const client = createPublicClient({
  chain: bsc,
  transport: http('https://public-bsc.nownodes.io/')
});

const receipt = await client.getTransactionReceipt({
  hash: '0xc11c8747037a99feafece6868b4dec8acb626ab33002fc0579e386a9bb4469bb'
});

const log = receipt.logs[599];
console.log('Log topics:', log.topics);
console.log('Log data:', log.data);
console.log('Log address:', log.address);
console.log('\nAll logs in transaction:');
receipt.logs.forEach((l, i) => {
  console.log(`Log ${i}: address=${l.address}, topics[0]=${l.topics[0]?.slice(0, 10)}...`);
});
