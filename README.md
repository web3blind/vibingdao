# VibingDAO

Bitcoin L1 governance DAO built on [OPNet](https://opnet.org) — Vibecoding Challenge Week 3.

## What it does

- **Stake** any OP_20 token (defaults to VIBE, the built-in governance token) to earn voting weight
- **Create proposals** — text (simple majority) or treasury (token transfer + quorum)
- **Vote** — weighted by staked balance, one vote per address per proposal
- **Execute** — after the voting window closes, anyone can execute; passing treasury proposals transfer tokens automatically

## Structure

```
contract/   AssemblyScript OP_NET smart contract
  src/dao/VibingDAO.ts   — main contract
  src/dao/events/        — DAO events
  build/VibingDAO.wasm   — compiled WASM (40 KB)
  abis/VibingDAO.abi.json

frontend/   React + Vite dApp
  src/opnet.ts           — provider & contract singleton
  src/useDao.ts          — all read/write hooks
  src/App.tsx            — UI
```

## Testnet deployment

| | |
|---|---|
| Network | OPNet Testnet (Signet) |
| Contract | `opt1sqze6skcwhe2jju5znavldlldcr4mugrgtgkcncq7` |
| Funding TX | `53d8c20f51e8bfb9ef6c77744eb0b2243447a1307fa17955ab0d55b744490c7a` |
| Reveal TX | `921626545aca6c2cd8f84f44e8775a60e14960641d291cf34ddfa1a83e2d4575` |

## Build & run

```bash
# Contract
npm install
npm run build       # → build/VibingDAO.wasm

# Frontend
cd frontend
npm install
npm run dev
```

## Tech stack

- OPNet AssemblyScript runtime (`@btc-vision/btc-runtime`)
- `opnet` SDK for frontend contract interaction
- React 19 + Vite 7 + TypeScript
- OP_WALLET browser extension for signing
