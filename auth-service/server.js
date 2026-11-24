const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const voters = {
  VTR101: {
    voterId: "VTR101",
    name: "Aarav Sharma",
    phoneMasked: "+91 ••••••7841",
    walletAddress: "0xFFcf8FDEE72ac11b5c542428B35EEF5769C409f0",
    faceVerified: false,
    phoneKey: null,
    phoneVerified: false,
  },
  VTR102: {
    voterId: "VTR102",
    name: "Ananya Rao",
    phoneMasked: "+91 ••••••3920",
    walletAddress: "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b",
    faceVerified: false,
    phoneKey: null,
    phoneVerified: false,
  },
};

app.post("/api/verify-face", (req, res) => {
  const { voterId, imageBase64 } = req.body;
  const voter = voters[voterId];

  if (!voter) {
    return res.status(404).json({ ok: false, message: "Voter ID not found" });
  }
  if (!imageBase64) {
    return res.status(400).json({ ok: false, message: "Capture a webcam face scan first" });
  }

  voter.faceVerified = true;
  return res.json({
    ok: true,
    message: "Face scan matched for " + voter.name,
    phoneMasked: voter.phoneMasked,
    walletAddress: voter.walletAddress,
  });
});

app.post("/api/send-phone-key", (req, res) => {
  const { voterId } = req.body;
  const voter = voters[voterId];

  if (!voter || !voter.faceVerified) {
    return res.status(400).json({ ok: false, message: "Complete face scan first" });
  }

  const key = String(Math.floor(100000 + Math.random() * 900000));
  voter.phoneKey = key;
  voter.phoneVerified = false;

  console.log("[PHONE KEY -> " + voter.phoneMasked + "] Voter " + voterId + " Key: " + key);

  return res.json({
    ok: true,
    message: "Verification key sent to " + voter.phoneMasked,
    demoKey: key,
  });
});

app.post("/api/verify-phone-key", (req, res) => {
  const { voterId, keyInput } = req.body;
  const voter = voters[voterId];

  if (!voter || !voter.phoneKey) {
    return res.status(400).json({ ok: false, message: "Send the phone key first" });
  }

  if (String(keyInput).trim() !== voter.phoneKey) {
    return res.status(401).json({ ok: false, message: "Invalid verification key" });
  }

  voter.phoneVerified = true;
  return res.json({
    ok: true,
    message: "Phone verification key confirmed. Ballot unlocked.",
  });
});

app.listen(4000, () => {
  console.log("Auth & Phone Key service running on http://localhost:4000");
});
