const express = require("express");
const app = express();
app.use(express.json());

// ✅ Your n8n webhook URL
const N8N_WEBHOOK_URL = "https://khanakarodia.app.n8n.cloud/webhook-test/BPO_API";

// Store last 100 calls in memory
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
  if (callLog.length > 100) callLog.pop();

  // Forward every call to n8n — n8n's IF node decides what to do
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
// Helpers
// ─────────────────────────────────────────
function outcomeBadge(outcome) {
  const map = {
    REFERRAL_CAPTURED:         { bg:"#e6f4d7", color:"#2d6a0a" },
    REFERRAL_WHATSAPP_PENDING: { bg:"#d1fae5", color:"#065f46" },
    REFERRAL_PARTIAL:          { bg:"#fef9c3", color:"#713f12" },
    NO_REFERRAL:               { bg:"#f3f4f6", color:"#6b7280" },
    CALLER_SELF_INTERESTED:    { bg:"#dbeafe", color:"#1e40af" },
    CALL_NOT_CONNECTED:        { bg:"#fee2e2", color:"#991b1b" },
    CALL_INCOMPLETE:           { bg:"#ffedd5", color:"#9a3412" },
    CALLBACK_REQUESTED:        { bg:"#ede9fe", color:"#5b21b6" },
  };
  const s = map[outcome] || { bg:"#f3f4f6", color:"#6b7280" };
  return `<span style="background:${s.bg};color:${s.color};padding:3px 10px;border-radius:99px;font-size:11px;font-weight:500;white-space:nowrap">${outcome || "UNKNOWN"}</span>`;
}

function scoreColor(score) {
  const n = parseInt(score);
  if (n >= 8) return "#16a34a";
  if (n >= 5) return "#d97706";
  return "#dc2626";
}

function pfColor(val) {
  if (!val || val === "NA") return "#9ca3af";
  if (val === "Pass") return "#16a34a";
  if (val === "Fail") return "#dc2626";
  return "#d97706";
}

function waStatus(payload) {
  const outcome = payload.call_outcome || "";
  const next = payload.next_action_type || "";
  if (outcome === "REFERRAL_CAPTURED" || next === "SEND_WHATSAPP_MESSAGE") {
    return `<span style="color:#16a34a;font-weight:500;font-size:13px">✓ Message sent on WhatsApp</span>`;
  }
  if (outcome === "REFERRAL_WHATSAPP_PENDING") {
    return `<span style="color:#d97706;font-weight:500;font-size:13px">⏳ WhatsApp pending</span>`;
  }
  return `<span style="color:#9ca3af;font-size:13px">— Not sent</span>`;
}

// ─────────────────────────────────────────
// GET /  ← Live Dashboard
// ─────────────────────────────────────────
app.get("/", (req, res) => {

  const total     = callLog.length;
  const referrals = callLog.filter(c => c.has_referral === "Yes").length;
  const waSent    = callLog.filter(c =>
    c.call_outcome === "REFERRAL_CAPTURED" || c.next_action_type === "SEND_WHATSAPP_MESSAGE"
  ).length;
  const callbacks = callLog.filter(c => c.callback_requested === "Yes").length;

  const scoreKeys = [
    ["score_introduction_clarity",      "Intro"],
    ["score_call_flow_adherence",        "Flow"],
    ["score_objection_handling",         "Objection"],
    ["score_close_quality",              "Close"],
    ["score_anti_pitch_compliance",      "Anti-pitch"],
    ["score_clarification_control",      "Clarification"],
    ["score_interruption_handling",      "Interruption"],
    ["score_no_dead_air_compliance",     "No dead air"],
    ["score_one_question_at_a_time",     "1-Q-at-a-time"],
    ["score_details_channel_handling",   "Channel"],
  ];

  const rows = callLog.map(c => {
    const scoreHtml = scoreKeys.map(([key, label]) => {
      const val = c[key];
      if (!val || val === "NA") return "";
      const bg = val === "Pass" ? "#e6f4d7" : val === "Fail" ? "#fee2e2" : "#fef9c3";
      return `<span style="font-size:10px;background:${bg};color:${pfColor(val)};padding:2px 7px;border-radius:4px;margin:2px;display:inline-block">${label}: ${val}</span>`;
    }).join("");

    const referralBlock = (c.referral_name && c.referral_name !== "NOT_CAPTURED")
      ? `<b>${c.referral_name}</b><br>
         ${c.referral_contact !== "NOT_CAPTURED" ? `<span style="font-size:12px;color:#555">${c.referral_contact}</span><br>` : ""}
         ${c.referral_designation !== "NOT_CAPTURED" ? `<span style="font-size:11px;color:#888">${c.referral_designation}</span>` : ""}`
      : "—";

    return `
    <tr>
      <td style="font-weight:500;white-space:nowrap">
        ${c.caller_name || "—"}
        <br><span style="font-size:11px;color:#888;font-weight:400">${c.call_date || "—"}</span>
        <br><span style="font-size:11px;color:#aaa;font-weight:400">${c.call_duration || "—"}</span>
      </td>
      <td>${outcomeBadge(c.call_outcome)}<br>
        <span style="font-size:11px;color:#888;margin-top:4px;display:block">${c.outcome_reason || ""}</span>
      </td>
      <td>${referralBlock}</td>
      <td style="text-align:center">
        <span style="font-size:22px;font-weight:600;color:${scoreColor(c.overall_score)}">${c.overall_score || "—"}</span>
        <span style="font-size:10px;color:#aaa">/10</span>
      </td>
      <td>${waStatus(c)}<br>
        <span style="font-size:11px;color:#888">${c.details_channel || ""}</span>
      </td>
      <td style="font-size:12px;color:#444;max-width:180px;line-height:1.5">${c.call_summary || "—"}</td>
    </tr>
    <tr style="background:#fafafa">
      <td colspan="6" style="padding:6px 14px 12px;border-bottom:2px solid #e5e7eb">
        <div style="margin-bottom:4px">${scoreHtml || '<span style="font-size:11px;color:#ccc">No scores captured</span>'}</div>
        ${c.quality_flags && c.quality_flags !== "NO FLAGS RAISED"
          ? `<div style="font-size:11px;color:#dc2626;margin-top:4px">⚠ ${c.quality_flags}</div>` : ""}
        ${c.next_action_detail
          ? `<div style="font-size:11px;color:#2563eb;margin-top:4px">▶ Next action: ${c.next_action_detail}</div>` : ""}
        ${c.caller_interested_in_role === "Yes"
          ? `<div style="font-size:11px;color:#7c3aed;margin-top:2px">★ Caller interested in role</div>` : ""}
      </td>
    </tr>`;
  }).join("");

  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Hunar Call Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; padding: 24px; color: #111; background: #f4f4f5; }
    .inner { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
    .sub { color: #888; font-size: 13px; margin-bottom: 20px; }
    .url-box { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 16px; font-family: monospace; font-size: 13px; margin-bottom: 20px; color: #374151; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .metric { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px 18px; }
    .metric-label { font-size: 12px; color: #888; margin-bottom: 4px; }
    .metric-val { font-size: 28px; font-weight: 600; color: #111; }
    .metric-val.green { color: #16a34a; }
    .metric-val.amber { color: #d97706; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; border: 1px solid #e5e7eb; font-size: 13px; }
    th { text-align: left; padding: 10px 14px; background: #f9fafb; font-weight: 500; font-size: 11px; color: #6b7280; border-bottom: 1px solid #e5e7eb; text-transform: uppercase; letter-spacing: 0.04em; }
    td { padding: 10px 14px; vertical-align: top; border-bottom: 1px solid #f0f0f0; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #22c55e; margin-right: 6px; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }
    .empty { color: #aaa; text-align: center; padding: 48px; font-size: 14px; }
    @media(max-width:700px){ .metrics{grid-template-columns:repeat(2,1fr)} }
  </style>
</head>
<body>
<div class="inner">
  <h1>Hunar Call Dashboard</h1>
  <p class="sub"><span class="dot"></span>Live · Auto-refreshes every 10 seconds</p>

  <div class="url-box">
    Webhook URL — give this to Hunar: <strong>${req.protocol}://${req.hostname}/webhook</strong>
  </div>

  <div class="metrics">
    <div class="metric"><div class="metric-label">Total calls</div><div class="metric-val">${total}</div></div>
    <div class="metric"><div class="metric-label">Referrals captured</div><div class="metric-val green">${referrals}</div></div>
    <div class="metric"><div class="metric-label">WhatsApp messages sent</div><div class="metric-val green">${waSent}</div></div>
    <div class="metric"><div class="metric-label">Callbacks requested</div><div class="metric-val amber">${callbacks}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Caller</th>
        <th>Outcome</th>
        <th>Referral details</th>
        <th>Score</th>
        <th>WhatsApp</th>
        <th>Call summary</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="6" class="empty">Waiting for first call from Hunar…</td></tr>`}
    </tbody>
  </table>
</div>
<script>setTimeout(()=>location.reload(), 10000)</script>
</body>
</html>`);
});

// GET /health
app.get("/health", (req, res) => res.json({ status: "ok", calls: callLog.length }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook receiver running on port ${PORT}`));
