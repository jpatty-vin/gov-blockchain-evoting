New-Item -ItemType Directory -Path ".\scripts" -Force | Out-Null
@"
import hre from "hardhat";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const connection = await hre.network.connect();
  const artifact = await hre.artifacts.readArtifact("ElectionBallot");

  const [adminWallet] = await connection.viem.getWalletClients();
  const deployHash = await adminWallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as `0x${string}`,
  });

  const receipt = await connection.viem.getPublicClient().then((c) =>
    c.waitForTransactionReceipt({ hash: deployHash })
  );

  const address = receipt.contractAddress;
  console.log("ElectionBallot deployed to Ganache at:", address);

  const outputDir = path.resolve(__dirname, "../../frontend/src/contract");
  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(
    path.join(outputDir, "ElectionBallot.json"),
    JSON.stringify({ address, abi: artifact.abi }, null, 2)
  );
  console.log("Saved ABI & address to frontend/src/contract/ElectionBallot.json");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
"@ | Out-File -FilePath ".\scripts\deploy.ts" -Encoding utf8
npx hardhat run scripts/deploy.ts --network ganache