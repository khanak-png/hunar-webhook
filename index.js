const express = require("express");
const app = express();
app.use(express.json());

// ✅ Your n8n webhook URL
const N8N_WEBHOOK_URL = "https://khanakarodia.app.n8n.cloud/webhook-test/BPO_API";

// Store last 50 calls in memory (for dashboard)
const callLog = [];

// ─────────────────────────────────────────
// POST /webhook  ← Hunar sends call results here
// ─────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  const payload = req.body;
  const receivedAt = new Date().toISOString();

  console.log("📞 Received from Hunar:", JSON.stringify(payload, null, 2));

  // Save to in-memory log
  callLog.unshift({ ...payload, receivedAt });
  if (callLog.length > 50) callLog.pop();

  // Forward every call to n8n (n8n's IF node decides what to do)
  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, receivedAt }),
    });

    console.log("✅ Forwarded to n8n. Status:", response.status);
    res.status(200).json({ success: true, forwarded: true, receivedAt });

  } catch (err) {
    console.error("❌ Failed to forward to n8n:", err.message);
    res.status(200).json({ success: true, forwarded: false, error: err.message });
  }
});

// ─────────────────────────────────────────
// GET /  ← Dashboard UI
// ─────────────────────────────────────────
app.get("/", (req, res) => {
  const rows = callLog.map(c => `
    <tr>
      <td>${c.name || c.contact_name || "—"}</td>
      <td>${c.phone || c.mobile || "—"}</td>
      <td><span class="pill ${c.outcome || c.result || 'unknown'}">${c.outcome || c.result || "unknown"}</span></td>
      <td>${new Date(c.receivedAt).toLocaleTimeString("en-IN")}</td>
      <td>${(c.outcome || c.result) === "referral" ? '✅ Message sent on WhatsApp' : '— Not sent'}</td>
    </tr>
  `).join("");

  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Hunar Webhook Receiver</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #111; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
    .sub { color: #888; font-size: 13px; margin-bottom: 24px; }
    .url-box { background: #f5f5f5; border-radius: 8px; padding: 12px 16px; font-family: monospace; font-size: 13px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; padding: 10px 12px; background: #f9f9f9; font-weight: 500; font-size: 12px; color: #666; border-bottom: 1px solid #eee; }
    td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; }
    .pill { padding: 3px 10px; border-radius: 99px; font-size: 12px; font-weight: 500; }
    .referral { background: #e6f4d7; color: #2d6a0a; }
    .interested { background: #dbeafe; color: #1e40af; }
    .callback { background: #fef3c7; color: #92400e; }
    .not_interested, .unknown { background: #f3f4f6; color: #6b7280; }
    .wa-sent { color: #16a34a; font-size: 13px; font-weight: 500; }
    .wa-not { color: #9ca3af; font-size: 13px; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #22c55e; margin-right: 8px; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }
    .empty { color: #aaa; text-align: center; padding: 32px; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Hunar Webhook Receiver</h1>
  <p class="sub"><span class="dot"></span>Live · Forwarding all calls to n8n</p>
  <div class="url-box">POST endpoint: <strong>${req.protocol}://${req.hostname}/webhook</strong></div>
  <table>
    <thead><tr><th>Name</th><th>Phone</th><th>Outcome</th><th>Received at</th><th>WhatsApp</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="empty">Waiting for first call from Hunar…</td></tr>'}</tbody>
  </table>
  <script>setTimeout(()=>location.reload(), 10000)</script>
</body>
</html>`);
});

// ─────────────────────────────────────────
// GET /health ← Render keep-alive ping
// ─────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook receiver running on port ${PORT}`));
