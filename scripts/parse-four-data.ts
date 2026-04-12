const data = '0x000000000000000000000000b4231ec499ec91c8389cbe3e58e81d0bfd964444000000000000000000000000000000000000000000a56fa5b99019a5c80000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f4cdde89a01334fc';

// Remove 0x prefix
const hex = data.slice(2);

// Each parameter is 32 bytes (64 hex chars)
const param1 = '0x' + hex.slice(0, 64).slice(24); // base token (address, last 20 bytes)
const param2 = '0x' + hex.slice(64, 128); // offers (uint256)
const param3 = '0x' + hex.slice(128, 192).slice(24); // quote token (address, last 20 bytes)
const param4 = '0x' + hex.slice(192, 256); // funds (uint256)

console.log('LiquidityAdded event parameters:');
console.log('  base (meme token):', param1);
console.log('  offers:', BigInt(param2).toString());
console.log('  quote (WBNB):', param3);
console.log('  funds:', BigInt(param4).toString());
