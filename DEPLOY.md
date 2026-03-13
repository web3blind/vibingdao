# VibingDAO — Deployment Guide

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 18 | https://nodejs.org |
| npm | ≥ 9 | bundled with Node |
| OP_NET CLI | latest | `npm i -g @btc-vision/opnet-cli` |
| Bitcoin wallet | — | OP_NET-compatible (e.g. UniSat w/ OP_NET extension) |
| Testnet BTC | ~0.001 | Bitcoin Signet faucet |

---

## 1. Install dependencies & build

```bash
cd vibingdao
npm install
```

> **CRITICAL — apply the Networks.ts patch before building.**
> `@btc-vision/btc-runtime@1.10.x` ships with `OPNetTestnet` removed from its
> `Networks` enum. Every contract deployed on OPNet testnet without this patch
> will revert with `"Unknown chain id"` during `onDeployment` and its bytecode
> will never be stored. The contract will appear deployed but will be
> permanently inoperable (`btc_getCode` returns "Contract bytecode not found").

After `npm install`, open
`node_modules/@btc-vision/btc-runtime/runtime/script/Networks.ts` and:

**1. Add the enum value:**
```diff
 export enum Networks {
     Unknown = -1,
     Mainnet = 0,
     Testnet = 1,
     Regtest = 2,
+    OPNetTestnet = 3,
 }
```

**2. Add the field and constructor initialisation inside `NetworkManager`:**
```diff
+    private readonly opnetTestnet: Uint8Array;

     constructor() {
         // … existing mainnet/testnet/regtest blocks …
+
+        const opnetTestnet = new Uint8Array(32);
+        opnetTestnet.set([
+            0x00, 0x00, 0x01, 0x7f, 0x85, 0x10, 0x6b, 0x1f, 0xee, 0xaf, 0x2f, 0x70, 0xf1, 0xe2,
+            0xb8, 0x05, 0x98, 0x5b, 0xb5, 0x75, 0xf8, 0x8f, 0x9b, 0x0b, 0xa5, 0x75, 0x3d, 0x2f,
+            0x3c, 0xf1, 0x32, 0x73,
+        ]);
+        this.opnetTestnet = opnetTestnet;
     }
```

**3. Add the `hrp()` case:**
```diff
+            case Networks.OPNetTestnet:
+                return 'opt';
```

**4. Add the `getChainId()` case:**
```diff
+            case Networks.OPNetTestnet:
+                out.set(this.opnetTestnet);
+                return out;
```

**5. Add the `fromChainId()` check (before the final `throw`):**
```diff
+        if (this.equals(chainId, this.opnetTestnet)) return Networks.OPNetTestnet;
```

Then build:

```bash
npm run build          # produces build/VibingDAO.wasm
```

Verify the WASM is valid before deploying:

```bash
node -e "
const fs = require('fs');
WebAssembly.compile(fs.readFileSync('build/VibingDAO.wasm'))
  .then(m => {
    const ex = WebAssembly.Module.exports(m).map(e => e.name);
    console.log('Size:', fs.statSync('build/VibingDAO.wasm').size, 'bytes');
    console.log('Exports OK:', ['execute','onDeploy','memory','start','abort'].every(e => ex.includes(e)));
  });
"
```

Expected output:
```
Size: ~40800 bytes
Exports OK: true
```

---

## 2. Calldata encoding

`onDeployment` reads five parameters in order:

| # | Type | Description | Default (if zero/empty) |
|---|------|-------------|-------------------------|
| 1 | `u256` | Governance token max supply | `2 100 000 000 000 000` (21 M × 10^8) |
| 2 | `u8` | Governance token decimals | `8` |
| 3 | `u256` | Voting duration (blocks) | `144` (~1 Bitcoin day) |
| 4 | `u256` | Quorum percent for treasury proposals | `10` (10%) |
| 5 | `address` | Staking token address | `Address.zero()` → uses VIBE itself |

### Encode with OP_NET CLI

```bash
# Default DAO — staking VIBE, 144-block window, 10 % quorum
opnet calldata encode \
  --uint256 0 \
  --uint8   0 \
  --uint256 0 \
  --uint256 0 \
  --address 0000000000000000000000000000000000000000000000000000000000000000
```

### Encode with JavaScript (Node)

```js
import { BytesWriter } from '@btc-vision/btc-runtime/runtime';
import { u256 } from '@btc-vision/as-bignum/assembly';

const w = new BytesWriter(1 + 32 + 32 + 32 + 32 + 32);  // rough upper bound
w.writeU256(u256.Zero);          // maxSupply  → default
w.writeU8(0);                    // decimals   → default (8)
w.writeU256(u256.Zero);          // duration   → default (144 blocks)
w.writeU256(u256.Zero);          // quorum     → default (10%)
w.writeAddress(new Uint8Array(32)); // staking token → zero → VIBE

console.log('Calldata hex:', Buffer.from(w.getBuffer()).toString('hex'));
```

---

## 3. Deploy to OPNet testnet

> **IMPORTANT:** OPNet testnet is a **Signet fork** — use `networks.opnetTestnet`
> (NOT `networks.testnet` which is Testnet4).

```bash
opnet deploy \
  --network  opnet-testnet \
  --wasm     build/VibingDAO.wasm \
  --calldata <hex from step 2>
```

Or use the OP_NET web deployer:
1. Navigate to https://testnet.opnet.org
2. Connect your wallet
3. Upload `build/VibingDAO.wasm`
4. Paste the encoded calldata
5. Confirm the transaction

After deployment you will receive a **contract address** — save it.

---

## 4. Verify deployment

```bash
# Check ABI and method availability
opnet contract info --network opnet-testnet --address <CONTRACT_ADDRESS>

# Verify staking token (should be the contract itself for default deploy)
opnet call \
  --network  opnet-testnet \
  --address  <CONTRACT_ADDRESS> \
  --method   getStakingToken
```

---

## 5. Using the DAO

### Stake tokens (requires prior `approve`)

```bash
# 1. Approve DAO to spend your VIBE
opnet call \
  --network opnet-testnet \
  --address <VIBE_TOKEN_ADDRESS> \
  --method  approve \
  --address <DAO_ADDRESS> \
  --uint256 <AMOUNT>

# 2. Stake
opnet call \
  --network opnet-testnet \
  --address <DAO_ADDRESS> \
  --method  stake \
  --uint256 <AMOUNT>
```

### Create a text proposal

```bash
opnet call \
  --network opnet-testnet \
  --address <DAO_ADDRESS> \
  --method  createProposal \
  --uint8   0 \                         # 0 = text
  --uint256 <SHA256_OF_DESCRIPTION> \
  --uint256 0 \                         # amount (unused for text)
  --address 0000...0000 \              # recipient (unused for text)
  --address 0000...0000               # token (unused for text)
```

### Create a treasury proposal

```bash
opnet call \
  --network opnet-testnet \
  --address <DAO_ADDRESS> \
  --method  createProposal \
  --uint8   1 \                         # 1 = treasury
  --uint256 <SHA256_OF_DESCRIPTION> \
  --uint256 <TOKEN_AMOUNT> \
  --address <RECIPIENT_ADDRESS> \
  --address <TOKEN_CONTRACT_ADDRESS>   # zero → staking token
```

### Vote

```bash
opnet call \
  --network opnet-testnet \
  --address <DAO_ADDRESS> \
  --method  vote \
  --uint256 <PROPOSAL_ID> \
  --bool    true                        # true = YES, false = NO
```

### Execute (after voting period ends)

```bash
opnet call \
  --network opnet-testnet \
  --address <DAO_ADDRESS> \
  --method  executeProposal \
  --uint256 <PROPOSAL_ID>
```

---

## 6. ABI

The generated ABI is at `abis/VibingDAO.abi.json`.
Copy it to your frontend or SDK integration.

### `getProposal` return layout (BYTES, packed)

Since OPNetTransform does not yet support TUPLE ABI types, `getProposal` returns raw packed bytes.
Decode in order:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 1 byte | `proposalType` (u8: 0 = text, 1 = treasury) |
| 1 | 32 bytes | `yesVotes` (u256, big-endian) |
| 33 | 32 bytes | `noVotes` (u256, big-endian) |
| 65 | 32 bytes | `deadline` (u256 block number) |
| 97 | 1 byte | `executed` (bool: 0 or 1) |
| 98 | 32 bytes | `amount` (u256) |
| 130 | 32 bytes | `descriptionHash` (u256) |
| 162 | 32 bytes | `recipient` (u256 / address, zero if text proposal) |

Total: 194 bytes.

---

## 7. Mainnet checklist

Before deploying to mainnet:

- [ ] Audit contract for reentrancy, overflow, and access control
- [ ] Set a meaningful `votingDuration` (144 blocks ≈ 1 day, 1008 ≈ 1 week)
- [ ] Set appropriate `quorumPercent` for your DAO size
- [ ] Decide staking token — deploying with external token requires that token to be live first
- [ ] Distribute VIBE governance tokens to initial stakeholders before any proposals
- [ ] Fund the treasury contract before executing any treasury proposals
