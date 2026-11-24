# National Digital Ballot & E-Voting Portal (`gov-blockchain-evoting`)

A full-stack decentralized e-voting prototype built on an Ethereum-compatible local blockchain (Ganache), combining a React + Vite web portal, an Express verification service, and a Solidity smart contract (`ElectionBallot.sol`) to enforce tamper-evident election rules and one-person-one-vote integrity.

---

## Architecture

| Component | Stack / Port | Responsibility |
| :--- | :--- | :--- |
| **Frontend Portal** | React + Vite (`http://localhost:5175/`) + Ethers v6 | Election Commission Admin Console, Voter verification & ballot UI, and live on-chain state polling |
| **Auth Service** | Node.js + Express (`http://localhost:4000/`) | Off-chain pre-vote verification and OTP authentication flow |
| **Blockchain Node** | Ganache (`http://127.0.0.1:8545`, Chain ID `1337`, `shanghai` hardfork) | Local EVM execution environment, deterministic accounts, and block mining |
| **Smart Contract** | Solidity `0.8.34` + Hardhat (`ElectionBallot.sol`) | On-chain access control, party registry, voter eligibility, and atomic vote tallying |

---

## Key Features & Smart Contract Guarantees

- **Strict Role Separation:**
  - `Account #0` is initialized as `commissionAdmin` on deployment and gated by the `onlyAdmin` modifier.
  - `Account #1+` act as voter accounts restricted to the voter ballot workflow.
- **Election Lifecycle Controls:** Admin can open, close, pause, or finalize voting; party additions and removals are locked once voting begins.
- **Atomic Double-Vote Prevention:** `castVoteByPartyNumber(uint256 _partyNumber)` verifies that the ballot is open (`whenOpen`), the voter is marked eligible (`isEligible`), the party number is valid, and `hasVoted` is `false`—reverting all state changes atomically if any condition fails.
- **Auditable Event Logs:** Emits `PartyRegistered`, `VoterEligibleSet`, `BallotStateChanged`, and `BallotCast` with block numbers and timestamps.
- **Shanghai EVM Compatibility:** Compiled with `evmVersion: "shanghai"` in `hardhat.config.ts` so struct array memory operations (`getAllParties()`) execute cleanly on Ganache.

---

## Repository Structure

```text
gov-blockchain-evoting/
├── auth-service/                 # Express server (:4000) for verification & OTP endpoints
├── blockchain/                   # Hardhat project, ElectionBallot.sol, and deploy scripts
│   ├── contracts/
│   │   └── ElectionBallot.sol
│   └── hardhat.config.ts
└── frontend/                     # React + Vite application (:5175)
    └── src/
        ├── App.jsx
        └── contract/
            └── ElectionBallot.json   # Synced contract address & ABI
