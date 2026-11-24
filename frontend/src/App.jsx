import { useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import contractArtifact from "./contract/ElectionBallot.json";
import "./App.css";

const AUTH_API = "http://localhost:4000";
const GANACHE_CHAIN_HEX = "0x539";
const GANACHE_RPC = "http://127.0.0.1:8545";

const LOCAL_ACCOUNTS = [
  { index: 0, label: "Account #0 (Admin)" },
  { index: 1, label: "Account #1 (Voter)" },
  { index: 2, label: "Account #2 (Voter)" },
];

function formatFriendlyError(err, fallback = "Action could not be completed.") {
  const raw = `${err?.reason || ""} ${err?.shortMessage || ""} ${err?.message || ""}`.toLowerCase();
  if (err?.code === 4001 || err?.code === "ACTION_REJECTED" || raw.includes("user rejected")) {
    return "Transaction was cancelled in your wallet.";
  }
  if (raw.includes("already voted") || raw.includes("duplicate vote")) {
    return "This wallet has already cast a vote. Each voter wallet can vote only once.";
  }
  if (raw.includes("voting is currently paused") || raw.includes("paused")) {
    return "Voting is currently paused by the election administrator.";
  }
  if (raw.includes("election is finalized") || raw.includes("finalized")) {
    return "This election is finalized and no longer accepts changes or votes.";
  }
  if (raw.includes("voting is closed") || raw.includes("ballot is closed")) {
    return "Voting is currently closed.";
  }
  if (raw.includes("cannot modify parties") || raw.includes("cannot remove parties")) {
    return "Parties cannot be added or removed once voting has started.";
  }
  if (raw.includes("admin cannot cast votes") || raw.includes("only election admin")) {
    return "Permission denied for this account role.";
  }
  if (raw.includes("invalid party number")) {
    return "Selected party number is not valid.";
  }
  if (raw.includes("network") || raw.includes("econnrefused") || raw.includes("failed to fetch")) {
    return "Blockchain connection issue. Verify Ganache is running on http://127.0.0.1:8545 (Chain ID 1337).";
  }
  return err?.shortMessage || err?.reason || fallback;
}

export default function App() {
  const [walletMode, setWalletMode] = useState("local"); // "local" | "metamask"
  const [localIndex, setLocalIndex] = useState(0);
  const [localAddresses, setLocalAddresses] = useState([]);

  const [account, setAccount] = useState("");
  const [adminAddress, setAdminAddress] = useState("");
  const [chainId, setChainId] = useState("1337");
  const [rpcHealthy, setRpcHealthy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Connecting to Ganache at http://127.0.0.1:8545...");
  const [errorMsg, setErrorMsg] = useState("");

  // Contract election state
  const [ballotOpen, setBallotOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [hasStartedVoting, setHasStartedVoting] = useState(false);
  const [totalVotesCast, setTotalVotesCast] = useState(0);
  const [parties, setParties] = useState([]);
  const [hasVoted, setHasVoted] = useState(false);

  // Voter workflow state
  const [voterId, setVoterId] = useState("VTR101");
  const [cameraActive, setCameraActive] = useState(false);
  const [faceImage, setFaceImage] = useState("");
  const [faceStatus, setFaceStatus] = useState("idle"); // "idle" | "verifying" | "verified" | "failed"
  const [faceVerified, setFaceVerified] = useState(false);
  const [phoneMasked, setPhoneMasked] = useState("");
  const [demoPhoneKey, setDemoPhoneKey] = useState("");
  const [phoneKeyInput, setPhoneKeyInput] = useState("");
  const [phoneStatus, setPhoneStatus] = useState("idle"); // "idle" | "sent" | "verifying" | "verified" | "failed"
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [selectedPartyNum, setSelectedPartyNum] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [castingVote, setCastingVote] = useState(false);
  const [receipt, setReceipt] = useState(null); // { status: "pending" | "confirmed", txHash, blockNumber, referenceId, timestamp }

  // Admin state (Open/Close/Pause/Finalize voting, Add/Remove party, Vote counts, Audit log)
  const [adminBusy, setAdminBusy] = useState(false);
  const [partyNumInput, setPartyNumInput] = useState("");
  const [partyNameInput, setPartyNameInput] = useState("");
  const [removePartyNumInput, setRemovePartyNumInput] = useState("");
  const [auditLogs, setAuditLogs] = useState([]);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const voteSubmitLockRef = useRef(false);

  const contractAddress = contractArtifact.address || contractArtifact.contractAddress;
  const contractAbi = contractArtifact.abi;

  const isAdminAccount = Boolean(
    account && adminAddress && account.toLowerCase() === adminAddress.toLowerCase()
  );
  const role = isAdminAccount ? "admin" : "voter";

  const electionStatus = finalized
    ? "Finalized"
    : paused
      ? "Paused"
      : ballotOpen
        ? "Open"
        : hasStartedVoting
          ? "Closed"
          : "Upcoming";

  const talliesVisible = !ballotOpen && !paused && (hasStartedVoting || finalized || electionStatus === "Closed");

  function appendAuditLog({ action, actor, status, txHash = "" }) {
    setAuditLogs((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        action,
        actor: actor || "Unknown",
        timestamp: new Date().toLocaleTimeString(),
        txHash,
        status,
      },
      ...prev,
    ]);
  }

  function clearVoterSession() {
    setFaceImage("");
    setFaceVerified(false);
    setFaceStatus("idle");
    setPhoneMasked("");
    setDemoPhoneKey("");
    setPhoneKeyInput("");
    setPhoneVerified(false);
    setPhoneStatus("idle");
    setSelectedPartyNum("");
    setShowConfirmModal(false);
    setReceipt(null);
  }

  function clearAdminInputs() {
    setPartyNumInput("");
    setPartyNameInput("");
    setRemovePartyNumInput("");
  }

  function getReadProvider() {
    if (walletMode === "metamask" && window.ethereum) {
      return new ethers.BrowserProvider(window.ethereum);
    }
    return new ethers.JsonRpcProvider(GANACHE_RPC);
  }

  async function getSigner() {
    if (walletMode === "metamask" && window.ethereum) {
      const provider = new ethers.BrowserProvider(window.ethereum);
      return await provider.getSigner();
    }
    const provider = new ethers.JsonRpcProvider(GANACHE_RPC);
    return await provider.getSigner(localIndex);
  }

  async function refreshChainState(currentAccount = account) {
    try {
      setErrorMsg("");
      const provider = getReadProvider();
      const contract = new ethers.Contract(contractAddress, contractAbi, provider);

      const [isOpen, rawParties, onChainAdmin] = await Promise.all([
        contract.ballotOpen(),
        contract.getAllParties(),
        typeof contract.commissionAdmin === "function" ? contract.commissionAdmin() : (typeof contract.commissionAdmin === "function" ? contract.commissionAdmin() : contract.admin()),
      ]);

      setRpcHealthy(true);
      setBallotOpen(Boolean(isOpen));
      setAdminAddress(onChainAdmin);

      // Optional newer contract getters—gracefully fall back if older ABI is deployed
      let isPaused = false;
      let isFinalized = false;
      let startedVoting = false;
      let votesTotal = 0;

      if (typeof contract.paused === "function") {
        isPaused = Boolean(await contract.paused());
      }
      if (typeof contract.finalized === "function") {
        isFinalized = Boolean(await contract.finalized());
      }
      if (typeof contract.hasStartedVoting === "function") {
        startedVoting = Boolean(await contract.hasStartedVoting());
      }
      if (typeof contract.totalVotesCast === "function") {
        votesTotal = Number(await contract.totalVotesCast());
      }

      const formatted = rawParties.map((p) => ({
        partyNumber: Number(p.partyNumber ?? p[0]),
        name: p.name ?? p[1],
        voteCount: Number(p.voteCount ?? p[2]),
      }));
      formatted.sort((a, b) => a.partyNumber - b.partyNumber);
      setParties(formatted);

      const summedVotes = formatted.reduce((acc, item) => acc + item.voteCount, 0);
      const effectiveTotal = votesTotal > 0 ? votesTotal : summedVotes;
      setTotalVotesCast(effectiveTotal);
      setHasStartedVoting(startedVoting || effectiveTotal > 0);
      setPaused(isPaused);
      setFinalized(isFinalized);

      if (currentAccount && ethers.isAddress(currentAccount)) {
        let voted = false;
        if (typeof contract.voters === "function") {
          const voterInfo = await contract.voters(currentAccount);
          voted = Boolean(voterInfo?.hasVoted ?? voterInfo?.[1] ?? false);
        } else if (typeof contract.hasVoted === "function") {
          voted = Boolean(await contract.hasVoted(currentAccount));
        }
        setHasVoted(Boolean(voted));
      } else {
        setHasVoted(false);
      }
    } catch (err) {
      setRpcHealthy(false);
      setErrorMsg(formatFriendlyError(err, "Unable to read election data from Ganache."));
    }
  }

  async function connectLocalAccount(idx = localIndex) {
    try {
      setErrorMsg("");
      const provider = new ethers.JsonRpcProvider(GANACHE_RPC);
      const [network, accounts] = await Promise.all([provider.getNetwork(), provider.listAccounts()]);

      if (!accounts || accounts.length === 0) {
        setRpcHealthy(false);
        setErrorMsg("No unlocked accounts found on Ganache (127.0.0.1:8545).");
        return;
      }

      const addrs = accounts.map((a) => (typeof a === "string" ? a : a.address));
      const chosen = addrs[idx] || addrs[0];

      clearVoterSession();
      clearAdminInputs();
      setLocalAddresses(addrs);
      setWalletMode("local");
      setChainId(String(Number(network.chainId)));
      setAccount(chosen);
      setStatusMsg(
        `Connected to Ganache · Account #${idx} (${chosen.slice(0, 6)}...${chosen.slice(-4)})`
      );
      await refreshChainState(chosen);
    } catch (err) {
      setRpcHealthy(false);
      setErrorMsg(formatFriendlyError(err, "Cannot connect to Ganache at http://127.0.0.1:8545."));
    }
  }

  async function connectMetaMask() {
    if (!window.ethereum) {
      await connectLocalAccount(localIndex);
      return;
    }
    try {
      setErrorMsg("");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      const network = await provider.getNetwork();
      const numChain = Number(network.chainId);
      const hexChain = "0x" + numChain.toString(16);

      setChainId(String(numChain));
      if (hexChain !== GANACHE_CHAIN_HEX) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: GANACHE_CHAIN_HEX }],
          });
          setChainId("1337");
        } catch {
          setErrorMsg("Wrong network selected. Switch to Ganache (Chain ID 1337 / http://127.0.0.1:8545).");
          return;
        }
      }

      const chosen = accounts[0] || "";
      clearVoterSession();
      clearAdminInputs();
      setWalletMode("metamask");
      setAccount(chosen);
      setStatusMsg(
        chosen
          ? `Connected via MetaMask (${chosen.slice(0, 6)}...${chosen.slice(-4)})`
          : "Wallet disconnected. Connect an account to continue."
      );
      await refreshChainState(chosen);
    } catch (err) {
      setErrorMsg(formatFriendlyError(err, "Wallet connection failed."));
    }
  }

  async function handleAccountChange(newIdx) {
    const idx = Number(newIdx);
    setLocalIndex(idx);
    await connectLocalAccount(idx);
  }

  useEffect(() => {
    connectLocalAccount(0);

    if (!window.ethereum) return;
    const onAccountsChanged = (accs) => {
      const next = accs?.[0] || "";
      clearVoterSession();
      clearAdminInputs();
      setAccount(next);
      if (!next) {
        setHasVoted(false);
        setStatusMsg("Wallet disconnected.");
        setErrorMsg("Wallet disconnected. Please reconnect your wallet.");
        return;
      }
      setStatusMsg(`Account changed to ${next.slice(0, 6)}...${next.slice(-4)}. Session reset.`);
      refreshChainState(next);
    };
    const onChainChanged = () => {
      clearVoterSession();
      window.location.reload();
    };

    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => {
      window.ethereum.removeListener("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener("chainChanged", onChainChanged);
    };
  }, []);

  // --- Voter Handlers ---
  async function startCamera() {
    if (role !== "voter") return;
    try {
      setErrorMsg("");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      setErrorMsg("Webcam unavailable—you can still click 'Verify Face Scan' for local verification.");
    }
  }

  function stopCamera() {
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }

  function captureSnapshot() {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = videoRef.current.videoWidth || 320;
    canvas.height = videoRef.current.videoHeight || 240;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    setFaceImage(canvas.toDataURL("image/jpeg", 0.7));
    stopCamera();
  }

  async function handleVerifyFace() {
    if (role !== "voter") return;
    try {
      setErrorMsg("");
      setFaceStatus("verifying");
      const payloadImage =
        faceImage ||
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      const res = await fetch(`${AUTH_API}/api/verify-face`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voterId, imageBase64: payloadImage }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFaceVerified(false);
        setFaceStatus("failed");
        setErrorMsg(data.message || "Face scan verification failed. Please try again.");
        return;
      }

      setFaceVerified(true);
      setFaceStatus("verified");
      setPhoneMasked(data.phoneMasked);
      setStatusMsg("Face scan verified. Proceed to Step 2 to request your phone verification key.");
    } catch {
      setFaceVerified(false);
      setFaceStatus("failed");
      setErrorMsg("Face verification failed: auth-service is unreachable on http://localhost:4000.");
    }
  }

  async function handleSendPhoneKey() {
    if (role !== "voter" || !faceVerified) return;
    try {
      setErrorMsg("");
      const res = await fetch(`${AUTH_API}/api/send-phone-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voterId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setPhoneStatus("failed");
        setErrorMsg(data.message || "Could not send phone verification key.");
        return;
      }
      setDemoPhoneKey(data.demoKey || "");
      setPhoneVerified(false);
      setPhoneStatus("sent");
      setStatusMsg(data.message || "Phone verification key sent.");
    } catch {
      setPhoneStatus("failed");
      setErrorMsg("Unable to send phone key: auth-service is unreachable on http://localhost:4000.");
    }
  }

  async function handleVerifyPhoneKey(e) {
    e.preventDefault();
    if (role !== "voter" || !faceVerified) return;
    try {
      setErrorMsg("");
      setPhoneStatus("verifying");
      const res = await fetch(`${AUTH_API}/api/verify-phone-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voterId, keyInput: phoneKeyInput }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setPhoneVerified(false);
        setPhoneStatus("failed");
        setErrorMsg(data.message || "Phone key verification failed. Check the 6-digit code and retry.");
        return;
      }
      setPhoneVerified(true);
      setPhoneStatus("verified");
      setStatusMsg("Phone key verified. Step 3 ballot is now unlocked.");
    } catch {
      setPhoneVerified(false);
      setPhoneStatus("failed");
      setErrorMsg("Phone key verification failed: auth-service is unreachable.");
    }
  }

  function openVoteConfirmation(e) {
    e.preventDefault();
    if (role !== "voter" || voteSubmitLockRef.current || castingVote) return;
    setErrorMsg("");

    if (!account) {
      setErrorMsg("Wallet disconnected. Connect a voter account first.");
      return;
    }
    if (!faceVerified || !phoneVerified) {
      setErrorMsg("Complete both Face Scan (Step 1) and Phone Key (Step 2) before voting.");
      return;
    }
    if (!ballotOpen || paused || finalized) {
      setErrorMsg(`Voting is currently ${electionStatus.toUpperCase()}.`);
      return;
    }
    if (hasVoted) {
      setErrorMsg("This wallet has already cast a vote.");
      return;
    }
    const partyNum = Number(selectedPartyNum);
    if (!partyNum || !parties.some((p) => p.partyNumber === partyNum)) {
      setErrorMsg("Please select a valid numbered party before continuing.");
      return;
    }
    setShowConfirmModal(true);
  }

  async function confirmAndCastVote() {
    if (role !== "voter" || voteSubmitLockRef.current || castingVote) return;
    const partyNum = Number(selectedPartyNum);

    try {
      voteSubmitLockRef.current = true;
      setCastingVote(true);
      setShowConfirmModal(false);
      setErrorMsg("");

      await refreshChainState(account);
      if (isAdminAccount) {
        setErrorMsg("Admin accounts cannot cast votes.");
        return;
      }
      if (!ballotOpen || paused || finalized) {
        setErrorMsg(`Voting is ${electionStatus.toUpperCase()} and cannot accept votes.`);
        return;
      }

      const signer = await getSigner();
      const contract = new ethers.Contract(contractAddress, contractAbi, signer);

      const tx = await contract.castVoteByPartyNumber(partyNum);
      setReceipt({
        status: "pending",
        txHash: tx.hash,
        blockNumber: null,
        referenceId: `REF-${tx.hash.slice(2, 10).toUpperCase()}`,
        timestamp: new Date().toLocaleString(),
      });
      setStatusMsg(`Vote transaction pending (${tx.hash.slice(0, 14)}...)...`);

      const txReceipt = await tx.wait();
      setReceipt({
        status: "confirmed",
        txHash: txReceipt.hash,
        blockNumber: txReceipt.blockNumber,
        referenceId: `REF-${txReceipt.hash.slice(2, 10).toUpperCase()}`,
        timestamp: new Date().toLocaleString(),
      });
      setHasVoted(true);
      setStatusMsg(`Vote confirmed on block #${txReceipt.blockNumber}.`);
      await refreshChainState(account);
    } catch (err) {
      setReceipt((prev) => (prev && prev.status === "pending" ? null : prev));
      setErrorMsg(formatFriendlyError(err, "Vote could not be recorded on the blockchain."));
    } finally {
      setCastingVote(false);
      voteSubmitLockRef.current = false;
    }
  }

  // --- Admin Handlers ---
  async function handleSetVotingOpen(openState) {
    if (role !== "admin" || adminBusy) return;
    if (!openState) {
      const confirmed = window.confirm("Are you sure you want to CLOSE voting?");
      if (!confirmed) return;
    }

    try {
      setAdminBusy(true);
      setErrorMsg("");
      const signer = await getSigner();
      const contract = new ethers.Contract(contractAddress, contractAbi, signer);
      const tx = await contract.setBallotOpen(openState);
      const txReceipt = await tx.wait();
      const label = openState ? "Open Voting" : "Close Voting";
      setStatusMsg(`${label} confirmed on block #${txReceipt.blockNumber}.`);
      appendAuditLog({
        action: label,
        actor: account,
        status: "Success",
        txHash: txReceipt.hash,
      });
      await refreshChainState(account);
    } catch (err) {
      const msg = formatFriendlyError(err, "Failed to update voting state.");
      setErrorMsg(msg);
      appendAuditLog({
        action: openState ? "Open Voting" : "Close Voting",
        actor: account,
        status: "Failed",
      });
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleTogglePause(nextPaused) {
    if (role !== "admin" || adminBusy) return;
    try {
      setAdminBusy(true);
      setErrorMsg("");
      const signer = await getSigner();
      const contract = new ethers.Contract(contractAddress, contractAbi, signer);
      if (typeof contract.setPaused !== "function") {
        throw new Error("Contract does not expose setPaused(bool); redeploy updated ElectionBallot.sol.");
      }
      const tx = await contract.setPaused(nextPaused);
      const txReceipt = await tx.wait();
      const actionLabel = nextPaused ? "Emergency Pause Voting" : "Resume Voting";
      setStatusMsg(`${actionLabel} confirmed on block #${txReceipt.blockNumber}.`);
      appendAuditLog({
        action: actionLabel,
        actor: account,
        status: "Success",
        txHash: txReceipt.hash,
      });
      await refreshChainState(account);
    } catch (err) {
      const msg = formatFriendlyError(err, "Failed to update pause state.");
      setErrorMsg(msg);
      appendAuditLog({
        action: nextPaused ? "Emergency Pause Voting" : "Resume Voting",
        actor: account,
        status: "Failed",
      });
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleFinalizeElection() {
    if (role !== "admin" || adminBusy) return;
    const confirmed = window.confirm(
      "Finalize this election permanently? Once finalized, voting cannot be reopened or modified."
    );
    if (!confirmed) return;

    try {
      setAdminBusy(true);
      setErrorMsg("");
      const signer = await getSigner();
      const contract = new ethers.Contract(contractAddress, contractAbi, signer);
      if (typeof contract.finalizeElection !== "function") {
        throw new Error("Contract does not expose finalizeElection(); redeploy updated ElectionBallot.sol.");
      }
      const tx = await contract.finalizeElection();
      const txReceipt = await tx.wait();
      setStatusMsg(`Election finalized on block #${txReceipt.blockNumber}.`);
      appendAuditLog({
        action: "Finalize Election",
        actor: account,
        status: "Success",
        txHash: txReceipt.hash,
      });
      await refreshChainState(account);
    } catch (err) {
      const msg = formatFriendlyError(err, "Failed to finalize election.");
      setErrorMsg(msg);
      appendAuditLog({
        action: "Finalize Election",
        actor: account,
        status: "Failed",
      });
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleAddParty(e) {
    e.preventDefault();
    if (role !== "admin" || adminBusy) return;
    const num = Number(partyNumInput);
    const cleanName = partyNameInput.trim();

    if (!Number.isInteger(num) || num < 1) {
      setErrorMsg("Enter a valid positive integer party number.");
      return;
    }
    if (!cleanName || cleanName.length < 2) {
      setErrorMsg("Enter a valid party name (at least 2 characters).");
      return;
    }
    if (parties.some((p) => p.partyNumber === num)) {
      setErrorMsg(`Party #${num} is already registered. Duplicate party numbers are not allowed.`);
      return;
    }
    if (hasStartedVoting) {
      setErrorMsg("Parties cannot be added once voting has started.");
      return;
    }

    try {
      setAdminBusy(true);
      setErrorMsg("");
      const signer = await getSigner();
      const contract = new ethers.Contract(contractAddress, contractAbi, signer);
      const tx = await contract.registerParty(cleanName, `#${num}`);
      const txReceipt = await tx.wait();
      setPartyNumInput("");
      setPartyNameInput("");
      setStatusMsg(`Added Party #${num} (${cleanName}) on block #${txReceipt.blockNumber}.`);
      appendAuditLog({
        action: `Add Party #${num}`,
        actor: account,
        status: "Success",
        txHash: txReceipt.hash,
      });
      await refreshChainState(account);
    } catch (err) {
      const msg = formatFriendlyError(err, "Failed to add party.");
      setErrorMsg(msg);
      appendAuditLog({
        action: `Add Party #${num}`,
        actor: account,
        status: "Failed",
      });
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleRemoveParty(e) {
    e.preventDefault();
    if (role !== "admin" || adminBusy) return;
    const num = Number(removePartyNumInput);

    if (!Number.isInteger(num) || num < 1) {
      setErrorMsg("Enter a valid party number to remove.");
      return;
    }
    const targetParty = parties.find((p) => p.partyNumber === num);
    if (!targetParty) {
      setErrorMsg(`Party #${num} was not found.`);
      return;
    }
    if (hasStartedVoting || targetParty.voteCount > 0) {
      setErrorMsg("Cannot remove a party once voting has started or votes have been recorded.");
      return;
    }
    if (ballotOpen) {
      setErrorMsg("Close voting before removing a party.");
      return;
    }

    try {
      setAdminBusy(true);
      setErrorMsg("");
      const signer = await getSigner();
      const contract = new ethers.Contract(contractAddress, contractAbi, signer);
      const tx = await contract.removeParty(num);
      const txReceipt = await tx.wait();
      setRemovePartyNumInput("");
      setStatusMsg(`Removed Party #${num} on block #${txReceipt.blockNumber}.`);
      appendAuditLog({
        action: `Remove Party #${num}`,
        actor: account,
        status: "Success",
        txHash: txReceipt.hash,
      });
      await refreshChainState(account);
    } catch (err) {
      const msg = formatFriendlyError(err, "Failed to remove party.");
      setErrorMsg(msg);
      appendAuditLog({
        action: `Remove Party #${num}`,
        actor: account,
        status: "Failed",
      });
    } finally {
      setAdminBusy(false);
    }
  }

  const selectedPartyObj = parties.find((p) => p.partyNumber === Number(selectedPartyNum));
  const partyModificationsLocked = hasStartedVoting || finalized;

  return (
    <div className="portal-shell">
      <header className="gov-header">
        <div className="gov-emblem">
          <div className="gov-badge">E-GOV · GANACHE</div>
          <div>
            <h1>National Digital Ballot &amp; Election Portal</h1>
            <p className="gov-subtitle">
              {role === "admin" ? "Election Commission Admin Console" : "Official Voter Ballot Portal"} ·{" "}
              {contractAddress ? `${contractAddress.slice(0, 8)}...${contractAddress.slice(-6)}` : "Contract"}
            </p>
          </div>
        </div>

        <div className="wallet-box">
          <span className={`pill status-pill status-${electionStatus.toLowerCase()}`}>
            Status: {electionStatus}
          </span>
          <span className="pill">Chain: {chainId || "1337"}</span>
          <span className="pill">{rpcHealthy ? "RPC: Online" : "RPC: Offline"}</span>
          <span className="pill role-pill">{role === "admin" ? "Admin Only" : "Voter Only"}</span>

          {walletMode === "local" ? (
            <select
              aria-label="Select Ganache Account"
              value={localIndex}
              onChange={(e) => handleAccountChange(e.target.value)}
            >
              {LOCAL_ACCOUNTS.map((item) => {
                const addr = localAddresses[item.index];
                const shortAddr = addr ? ` · ${addr.slice(0, 6)}...${addr.slice(-4)}` : "";
                return (
                  <option key={item.index} value={item.index}>
                    {item.label}
                    {shortAddr}
                  </option>
                );
              })}
            </select>
          ) : (
            <button className="btn btn-primary" type="button" onClick={connectMetaMask}>
              {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "Connect Wallet"}
            </button>
          )}
        </div>
      </header>

      <div className="status-banner" role="status" aria-live="polite">
        <strong>Status:</strong> {statusMsg}
        {errorMsg && (
          <div className="error-text" role="alert">
            {errorMsg}
          </div>
        )}
      </div>

      {role === "voter" ? (
        <main className="portal-grid">
          <section className="card">
            <h2>Voter Ballot &amp; Verification</h2>
            <p className="muted">
              Complete Step 1 (Face Scan) and Step 2 (Phone Key), then submit your numbered ballot in Step 3.
            </p>

            <div className="step-block">
              <h3>Step 1: Face Scan Authentication</h3>
              <div className="row-gap">
                <label>
                  Voter ID:
                  <select
                    value={voterId}
                    onChange={(e) => {
                      setVoterId(e.target.value);
                      setFaceVerified(false);
                      setFaceStatus("idle");
                      setPhoneVerified(false);
                      setPhoneStatus("idle");
                      setDemoPhoneKey("");
                      setPhoneKeyInput("");
                    }}
                  >
                    <option value="VTR101">VTR101 — Aarav Sharma (+91 â€¢â€¢â€¢â€¢â€¢â€¢7841)</option>
                    <option value="VTR102">VTR102 — Ananya Rao (+91 â€¢â€¢â€¢â€¢â€¢â€¢3920)</option>
                  </select>
                </label>

                {!cameraActive ? (
                  <button className="btn btn-secondary" type="button" onClick={startCamera}>
                    Start Webcam
                  </button>
                ) : (
                  <button className="btn btn-secondary" type="button" onClick={captureSnapshot}>
                    Capture Face
                  </button>
                )}
              </div>

              <div className="camera-area">
                <video ref={videoRef} className={cameraActive ? "media-box" : "hidden-box"} muted />
                <canvas ref={canvasRef} className="hidden-box" />
                {faceImage && !cameraActive && (
                  <img src={faceImage} alt="Captured face scan" className="media-box" />
                )}
              </div>

              <div className="row-gap">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={faceStatus === "verifying"}
                  onClick={handleVerifyFace}
                >
                  {faceStatus === "verifying"
                    ? "Verifying Face Scan..."
                    : faceVerified
                      ? "âœ“ Face Scan Verified"
                      : "Verify Face Scan"}
                </button>
                {faceStatus === "failed" && (
                  <span className="inline-badge badge-fail">Verification Failed</span>
                )}
                {faceVerified && (
                  <span className="inline-badge badge-ok">Identity Matched</span>
                )}
              </div>
            </div>

            <div className="step-block">
              <h3>Step 2: Phone Verification Key</h3>
              <p className="muted">
                {phoneVerified
                  ? `Verified for ${phoneMasked || "registered phone"}. Step 3 ballot unlocked.`
                  : `Request the key sent to ${phoneMasked || "your registered phone"} and enter it below.`}
              </p>

              <div className="row-gap">
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={!faceVerified}
                  onClick={handleSendPhoneKey}
                >
                  Send Key to Phone
                </button>
                {demoPhoneKey && (
                  <span className="demo-key-chip">
                    Phone Key (Demo): <strong>{demoPhoneKey}</strong>
                  </span>
                )}
              </div>

              <form className="row-gap mt-sm" onSubmit={handleVerifyPhoneKey}>
                <input
                  type="text"
                  placeholder="Enter 6-digit phone key"
                  value={phoneKeyInput}
                  onChange={(e) => setPhoneKeyInput(e.target.value)}
                  disabled={!faceVerified}
                  aria-label="6-digit phone verification key"
                />
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={!faceVerified || phoneStatus === "verifying"}
                >
                  {phoneStatus === "verifying"
                    ? "Checking Key..."
                    : phoneVerified
                      ? "âœ“ Key Confirmed"
                      : "Confirm Key"}
                </button>
                {phoneStatus === "failed" && (
                  <span className="inline-badge badge-fail">Key Check Failed</span>
                )}
              </form>
            </div>

            <div className="step-block">
              <h3>Step 3: Cast Vote by Party Number</h3>

              {electionStatus !== "Open" && (
                <div className="info-note">
                  Voting is currently <strong>{electionStatus}</strong>. Votes can only be submitted while voting is Open.
                </div>
              )}

              {hasVoted && (
                <div className="info-note">
                  This wallet has already cast a vote on the blockchain. Duplicate voting is blocked.
                </div>
              )}

              <form onSubmit={openVoteConfirmation}>
                <div className="party-grid">
                  {parties.length === 0 ? (
                    <p className="muted">No numbered parties are currently listed on the ballot.</p>
                  ) : (
                    parties.map((p) => {
                      const isSelected = Number(selectedPartyNum) === p.partyNumber;
                      return (
                        <label
                          key={p.partyNumber}
                          className={`party-tile ${isSelected ? "party-selected" : ""}`}
                        >
                          <input
                            type="radio"
                            name="partyChoice"
                            value={p.partyNumber}
                            checked={isSelected}
                            disabled={castingVote || hasVoted || electionStatus !== "Open"}
                            onChange={(e) => setSelectedPartyNum(e.target.value)}
                          />
                          <div className="party-num">#{p.partyNumber}</div>
                          <div className="party-name">{p.name}</div>
                        </label>
                      );
                    })
                  )}
                </div>

                <button
                  className="btn btn-success mt-md"
                  type="submit"
                  disabled={
                    castingVote ||
                    hasVoted ||
                    electionStatus !== "Open" ||
                    !faceVerified ||
                    !phoneVerified ||
                    !selectedPartyNum
                  }
                >
                  {castingVote ? "Submitting Vote..." : "Review & Cast Vote"}
                </button>
              </form>

              {receipt && (
                <div className="receipt-box">
                  <h4>
                    Blockchain Vote Receipt ({receipt.status === "confirmed" ? "Confirmed" : "Pending Confirmation"})
                  </h4>
                  <p>
                    <strong>Status:</strong>{" "}
                    {receipt.status === "confirmed" ? "Confirmed on Blockchain" : "Pending Block Confirmation"}
                  </p>
                  <p>
                    <strong>Verification Reference:</strong> {receipt.referenceId}
                  </p>
                  <p>
                    <strong>Block Number:</strong>{" "}
                    {receipt.blockNumber !== null && receipt.blockNumber !== undefined
                      ? `#${receipt.blockNumber}`
                      : "Pending..."}
                  </p>
                  <p className="mono-break">
                    <strong>Transaction Hash:</strong> {receipt.txHash}
                  </p>
                  <p className="muted">
                    Recorded at {receipt.timestamp}. Selected ballot choice is omitted from your receipt to protect vote secrecy.
                  </p>
                </div>
              )}
            </div>
          </section>

          <div className="right-stack">
            <section className="card">
              <div className="card-head">
                <h2>Ballot Summary</h2>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => refreshChainState(account)}
                >
                  Refresh
                </button>
              </div>
              <div className="stat-list">
                <div className="stat-row">
                  <span>Election Status</span>
                  <strong>{electionStatus}</strong>
                </div>
                <div className="stat-row">
                  <span>Registered Parties</span>
                  <strong>{parties.length}</strong>
                </div>
                <div className="stat-row">
                  <span>Total Votes Recorded</span>
                  <strong>{totalVotesCast}</strong>
                </div>
                <div className="stat-row">
                  <span>Your Voting Status</span>
                  <strong>{hasVoted ? "Vote Recorded" : "Not Voted"}</strong>
                </div>
              </div>
            </section>
          </div>
        </main>
      ) : (
        <main className="portal-grid">
          <div className="left-stack">
            <section className="card">
              <h2>Admin Console — Election &amp; Party Controls</h2>
              <p className="muted">
                Admin wallet: {adminAddress ? `${adminAddress.slice(0, 8)}...${adminAddress.slice(-6)}` : "Account #0"}.
              </p>

              <div className="step-block">
                <h3>1. Election State Controls</h3>
                <div className="row-gap">
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={adminBusy || finalized || ballotOpen}
                    onClick={() => handleSetVotingOpen(true)}
                  >
                    Open Voting
                  </button>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={adminBusy || finalized || !ballotOpen}
                    onClick={() => handleSetVotingOpen(false)}
                  >
                    Close Voting
                  </button>
                  {!paused ? (
                    <button
                      className="btn btn-warn"
                      type="button"
                      disabled={adminBusy || finalized}
                      onClick={() => handleTogglePause(true)}
                    >
                      Emergency Pause
                    </button>
                  ) : (
                    <button
                      className="btn btn-success"
                      type="button"
                      disabled={adminBusy || finalized}
                      onClick={() => handleTogglePause(false)}
                    >
                      Resume Voting
                    </button>
                  )}
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={adminBusy || finalized || ballotOpen}
                    onClick={handleFinalizeElection}
                  >
                    Finalize Election
                  </button>
                </div>
                <p className="muted mt-sm">
                  Finalize requires voting to be closed first and permanently locks the election.
                </p>
              </div>

              <div className="step-block">
                <form className="stack-sm" onSubmit={handleAddParty}>
                  <h3>2. Add Numbered Party</h3>
                  {partyModificationsLocked && (
                    <div className="info-note">
                      Party additions are disabled because voting has started or the election is finalized.
                    </div>
                  )}
                  <div className="row-gap">
                    <input
                      type="number"
                      min="1"
                      placeholder="Party # (e.g. 1)"
                      value={partyNumInput}
                      disabled={adminBusy || partyModificationsLocked}
                      onChange={(e) => setPartyNumInput(e.target.value)}
                      className="input-small"
                    />
                    <input
                      type="text"
                      placeholder="Party Name"
                      value={partyNameInput}
                      disabled={adminBusy || partyModificationsLocked}
                      onChange={(e) => setPartyNameInput(e.target.value)}
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      type="submit"
                      disabled={adminBusy || partyModificationsLocked}
                    >
                      Add Party
                    </button>
                  </div>
                </form>
              </div>

              <div className="step-block">
                <form className="stack-sm" onSubmit={handleRemoveParty}>
                  <h3>3. Remove Party</h3>
                  <p className="muted">
                    Only available before voting starts and while voting is closed.
                  </p>
                  <div className="row-gap">
                    <input
                      type="number"
                      min="1"
                      placeholder="Party # to remove"
                      value={removePartyNumInput}
                      disabled={adminBusy || partyModificationsLocked || ballotOpen}
                      onChange={(e) => setRemovePartyNumInput(e.target.value)}
                      className="input-small"
                    />
                    <button
                      className="btn btn-secondary btn-sm"
                      type="submit"
                      disabled={adminBusy || partyModificationsLocked || ballotOpen}
                    >
                      Remove Party
                    </button>
                  </div>
                </form>
              </div>
            </section>

            <section className="card">
              <h2>Admin Audit Log</h2>
              {auditLogs.length === 0 ? (
                <p className="muted">No admin actions recorded in this session yet.</p>
              ) : (
                <div className="table-wrap">
                  <table className="tally-table">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Admin Wallet</th>
                        <th>Time</th>
                        <th>Status</th>
                        <th>Tx Hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.action}</td>
                          <td className="mono-small">
                            {entry.actor.slice(0, 6)}...{entry.actor.slice(-4)}
                          </td>
                          <td>{entry.timestamp}</td>
                          <td>
                            <span
                              className={`inline-badge ${
                                entry.status === "Success" ? "badge-ok" : "badge-fail"
                              }`}
                            >
                              {entry.status}
                            </span>
                          </td>
                          <td className="mono-small">
                            {entry.txHash ? `${entry.txHash.slice(0, 10)}...` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div className="right-stack">
            <section className="card">
              <div className="card-head">
                <h2>Election Statistics</h2>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => refreshChainState(account)}
                >
                  Refresh
                </button>
              </div>

              <div className="stat-list mb-md">
                <div className="stat-row">
                  <span>Election Status</span>
                  <strong>{electionStatus}</strong>
                </div>
                <div className="stat-row">
                  <span>Total Votes Cast</span>
                  <strong>{totalVotesCast}</strong>
                </div>
                <div className="stat-row">
                  <span>Total Registered Parties</span>
                  <strong>{parties.length}</strong>
                </div>
                <div className="stat-row">
                  <span>Eligible Voter Count</span>
                  <strong>Open / Unbounded Local Registry</strong>
                </div>
                <div className="stat-row">
                  <span>Turnout Percentage</span>
                  <strong>N/A (No Fixed Voter Cap)</strong>
                </div>
                <div className="stat-row">
                  <span>Network / RPC</span>
                  <strong>
                    Chain {chainId || "1337"} · {rpcHealthy ? "Connected" : "Disconnected"}
                  </strong>
                </div>
              </div>

              {!talliesVisible ? (
                <div className="info-note">
                  Party-wise vote counts are hidden while voting is {electionStatus.toLowerCase()} to protect election integrity. Close or finalize voting to view party-wise results.
                </div>
              ) : (
                <table className="tally-table">
                  <thead>
                    <tr>
                      <th>Party No.</th>
                      <th>Party Name</th>
                      <th>Votes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parties.length === 0 ? (
                      <tr>
                        <td colSpan="3" className="muted">
                          No parties registered.
                        </td>
                      </tr>
                    ) : (
                      parties.map((p) => (
                        <tr key={p.partyNumber}>
                          <td>
                            <strong>#{p.partyNumber}</strong>
                          </td>
                          <td>{p.name}</td>
                          <td>
                            <strong>{p.voteCount}</strong>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </main>
      )}

      {role === "voter" && showConfirmModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-vote-title">
          <div className="modal-card">
            <h3 id="confirm-vote-title">Confirm Your Ballot Selection</h3>
            <p className="muted">
              Once submitted to the blockchain, your vote cannot be changed or cast a second time.
            </p>
            <div className="confirm-summary">
              <div>
                <strong>Selected Party:</strong> #{selectedPartyObj?.partyNumber} — {selectedPartyObj?.name}
              </div>
              <div>
                <strong>Voter Wallet:</strong> {account.slice(0, 8)}...{account.slice(-6)}
              </div>
            </div>
            <div className="row-gap mt-md">
              <button
                className="btn btn-secondary"
                type="button"
                disabled={castingVote}
                onClick={() => setShowConfirmModal(false)}
              >
                Go Back
              </button>
              <button
                className="btn btn-success"
                type="button"
                disabled={castingVote}
                onClick={confirmAndCastVote}
              >
                {castingVote ? "Submitting..." : "Confirm & Submit Vote"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
