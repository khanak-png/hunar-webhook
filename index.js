const express  = require("express");
const multer   = require("multer");
const fetch    = require("node-fetch");
const FormData = require("form-data");

const app    = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());

// ─────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────
const HUNAR_API_KEY   = process.env.HUNAR_API_KEY || "";
const HUNAR_BASE_URL  = "https://api.voice.hunar.ai/external/v1";
const N8N_WEBHOOK_URL = "https://khanakarodia.app.n8n.cloud/webhook/BPO_API";

// In-memory call log (last 100)
const callLog = [];

// ─────────────────────────────────────────
// POST /webhook  ← Hunar sends call results here
// ─────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  const payload    = req.body;
  const receivedAt = new Date().toISOString();

  // Attach the caller's number so n8n can send WhatsApp
  // Hunar sends it as "to_number" in the webhook payload
  const enriched = {
    ...payload,
    receivedAt,
    whatsapp_target: payload.to_number || payload.mobile_number || "NOT_CAPTURED"
  };

  callLog.unshift(enriched);
  if (callLog.length > 100) callLog.pop();

  console.log("📞 Webhook received:", JSON.stringify(enriched, null, 2));
  res.status(200).json({ success: true, receivedAt });
});

// ─────────────────────────────────────────
// GET /api/agents  ← fetch agents from Hunar
// ─────────────────────────────────────────
app.get("/api/agents", async (req, res) => {
  try {
    const r = await fetch(`${HUNAR_BASE_URL}/agents/`, {
      headers: { "X-API-Key": HUNAR_API_KEY, "Content-Type": "application/json" }
    });
    const data = await r.json();
    console.log("Hunar agents response:", JSON.stringify(data));
    res.json(data);
  } catch (err) {
    console.error("Error fetching agents:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// POST /api/campaigns  ← create campaign on Hunar
// ─────────────────────────────────────────
app.post("/api/campaigns", upload.single("file"), async (req, res) => {
  try {
    const { name, agent_id, description } = JSON.parse(req.body.data || "{}");

    const campaignData = {
      name,
      agent_id,
      description: description || "",
      remove_invalid_rows: true,
      remove_duplicate_phone_numbers: true,
      callback_config: {
        call_result_callback_url:  N8N_WEBHOOK_URL,
        call_summary_callback_url: N8N_WEBHOOK_URL,
        call_status_callback_url:  N8N_WEBHOOK_URL
      }
    };

    const form = new FormData();
    form.append("file", req.file.buffer, {
      filename:    req.file.originalname,
      contentType: "text/csv"
    });
    form.append("data", JSON.stringify(campaignData), {
      contentType: "application/json"
    });

    const r = await fetch(`${HUNAR_BASE_URL}/campaigns/`, {
      method:  "POST",
      headers: { "X-API-Key": HUNAR_API_KEY, ...form.getHeaders() },
      body:    form
    });

    const result = await r.json();
    if (r.status === 201) {
      res.json({ success: true, campaign: result });
    } else {
      res.status(r.status).json({ success: false, error: result });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────
// GET /health
// ─────────────────────────────────────────
app.get("/health", (req, res) => res.json({
  status: "ok",
  calls: callLog.length,
  api_key_set: !!HUNAR_API_KEY
}));

// ─────────────────────────────────────────
// GET /  ← Full Dashboard UI
// ─────────────────────────────────────────
app.get("/", (req, res) => {

  const total     = callLog.length;
  const referrals = callLog.filter(c => c.has_referral === "Yes").length;
  const waSent    = callLog.filter(c =>
    c.next_action_type === "SEND_WHATSAPP_MESSAGE" && c.whatsapp_consent === "Yes"
  ).length;
  const callbacks = callLog.filter(c => c.callback_requested === "Yes").length;

  function outcomeBadge(outcome) {
    const map = {
      REFERRAL_WHATSAPP_PENDING: { bg:"#d1fae5", color:"#065f46" },
      NO_REFERRAL:               { bg:"#f3f4f6", color:"#6b7280" },
      CALLER_SELF_INTERESTED:    { bg:"#dbeafe", color:"#1e40af" },
      CALL_NOT_CONNECTED:        { bg:"#fee2e2", color:"#991b1b" },
      CALL_INCOMPLETE:           { bg:"#ffedd5", color:"#9a3412" },
      CALLBACK_REQUESTED:        { bg:"#ede9fe", color:"#5b21b6" },
      COMPLETED:                 { bg:"#e6f4d7", color:"#2d6a0a" },
    };
    const s = map[outcome] || { bg:"#f3f4f6", color:"#6b7280" };
    return `<span style="background:${s.bg};color:${s.color};padding:3px 10px;border-radius:99px;font-size:11px;font-weight:500">${outcome || "UNKNOWN"}</span>`;
  }

  function waStatus(c) {
    const consent = c.whatsapp_consent || "";
    const next    = c.next_action_type  || "";
    if (next === "SEND_WHATSAPP_MESSAGE" && consent === "Yes")
      return `<span style="color:#16a34a;font-weight:500;font-size:13px">✓ Message sent on WhatsApp<br><span style="font-size:11px;font-weight:400">${c.whatsapp_target || ""}</span></span>`;
    if (next === "SEND_WHATSAPP_MESSAGE" && consent !== "Yes")
      return `<span style="color:#d97706;font-weight:500;font-size:13px">⏳ Pending consent</span>`;
    return `<span style="color:#9ca3af;font-size:13px">— Not sent</span>`;
  }

  function scoreColor(s) {
    const n = parseInt(s);
    if (n >= 8) return "#16a34a";
    if (n >= 5) return "#d97706";
    return "#dc2626";
  }

  const rows = callLog.map(c => `
    <tr>
      <td style="font-weight:500">
        ${c.caller_name || c.callee_name || "—"}
        <br><span style="font-size:11px;color:#888">${c.receivedAt ? new Date(c.receivedAt).toLocaleTimeString("en-IN") : "—"}</span>
      </td>
      <td>
        ${outcomeBadge(c.call_outcome || c.status)}
        <br><span style="font-size:11px;color:#888;margin-top:4px;display:block">${c.outcome_reason || ""}</span>
      </td>
      <td style="font-size:12px;color:#444">
        ${c.next_action_detail || "—"}
        ${c.caller_interested_in_role === "Yes"
          ? `<br><span style="font-size:11px;color:#7c3aed;margin-top:2px;display:block">★ Caller interested in role</span>` : ""}
        ${c.callback_requested === "Yes"
          ? `<br><span style="font-size:11px;color:#5b21b6">📅 Callback: ${c.callback_requested_time || "time not captured"}</span>` : ""}
      </td>
      <td style="text-align:center">
        <span style="font-size:22px;font-weight:600;color:${scoreColor(c.overall_score)}">${c.overall_score || "—"}</span>
        <span style="font-size:10px;color:#aaa">/10</span>
      </td>
      <td>${waStatus(c)}</td>
      <td style="font-size:12px;color:#444;max-width:160px;line-height:1.5">
        ${c.call_summary || "—"}
        ${c.quality_flags && c.quality_flags !== "NO FLAGS RAISED"
          ? `<br><span style="font-size:11px;color:#dc2626;margin-top:4px;display:block">⚠ ${c.quality_flags}</span>` : ""}
      </td>
    </tr>
  `).join("");

  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Hunar Call Dashboard</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box}
    body{font-family:-apple-system,sans-serif;margin:0;background:#f4f4f5;color:#111}
    .nav{background:#fff;border-bottom:1px solid #e5e7eb;padding:0 24px;display:flex;align-items:center}
    .nav-brand{font-weight:600;font-size:15px;margin-right:32px;padding:16px 0}
    .nav-tab{padding:16px 16px;font-size:14px;cursor:pointer;border-bottom:2px solid transparent;color:#6b7280;text-decoration:none;display:inline-block}
    .nav-tab.active{border-bottom-color:#111;color:#111;font-weight:500}
    .page{display:none;padding:24px;max-width:1200px;margin:0 auto}
    .page.active{display:block}
    h2{font-size:18px;font-weight:600;margin:0 0 4px}
    .sub{color:#888;font-size:13px;margin-bottom:20px}
    .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
    .metric{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px 18px}
    .metric-label{font-size:12px;color:#888;margin-bottom:4px}
    .metric-val{font-size:28px;font-weight:600}
    .metric-val.green{color:#16a34a}
    .metric-val.amber{color:#d97706}
    table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;font-size:13px}
    th{text-align:left;padding:10px 14px;background:#f9fafb;font-weight:500;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;text-transform:uppercase;letter-spacing:.04em}
    td{padding:10px 14px;vertical-align:top;border-bottom:1px solid #f0f0f0}
    .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-right:6px;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
    .empty{color:#aaa;text-align:center;padding:48px;font-size:14px}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;max-width:600px}
    .form-group{margin-bottom:18px}
    label{display:block;font-size:13px;font-weight:500;margin-bottom:6px;color:#374151}
    input,select,textarea{width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;outline:none;font-family:inherit}
    input:focus,select:focus{border-color:#6366f1}
    .btn{background:#111;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer}
    .btn:hover{background:#333}
    .btn:disabled{background:#9ca3af;cursor:not-allowed}
    .upload-area{border:2px dashed #d1d5db;border-radius:8px;padding:32px;text-align:center;cursor:pointer;color:#6b7280;font-size:14px}
    .upload-area:hover{border-color:#6366f1;color:#6366f1}
    .upload-area.has-file{border-color:#16a34a;background:#f0fdf4;color:#16a34a}
    .alert{padding:12px 16px;border-radius:8px;font-size:13px;margin-bottom:16px}
    .alert-success{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0}
    .alert-error{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
    .webhook-box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;font-family:monospace;font-size:12px;color:#374151;margin-bottom:20px}
    @media(max-width:700px){.metrics{grid-template-columns:repeat(2,1fr)}}
  </style>
</head>
<body>

<nav class="nav">
  <span class="nav-brand">Hunar Dashboard</span>
  <a class="nav-tab active" onclick="showPage('dashboard',this)">Live Calls</a>
  <a class="nav-tab" onclick="showPage('campaign',this)">Create Campaign</a>
</nav>

<!-- ── DASHBOARD PAGE ── -->
<div id="dashboard" class="page active">
  <h2 style="margin-top:8px">Live Call Dashboard</h2>
  <p class="sub"><span class="dot"></span>Auto-refreshes every 10 seconds</p>

  <div class="webhook-box">
    n8n receives directly from Hunar at: <strong>${N8N_WEBHOOK_URL}</strong>
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
        <th>Next action</th>
        <th>Score</th>
        <th>WhatsApp</th>
        <th>Summary & flags</th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="6" class="empty">Waiting for first call from Hunar…</td></tr>`}</tbody>
  </table>
</div>

<!-- ── CREATE CAMPAIGN PAGE ── -->
<div id="campaign" class="page">
  <h2 style="margin-top:8px">Create Campaign</h2>
  <p class="sub">Upload your CSV and launch a campaign — n8n webhook is attached automatically</p>

  <div class="card">
    <div id="alertBox"></div>

    <div class="form-group">
      <label>Campaign name</label>
      <input type="text" id="campName" placeholder="e.g. April Referral Drive" />
    </div>

    <div class="form-group">
      <label>Select agent</label>
      <select id="agentSelect">
        <option value="">Loading agents…</option>
      </select>
    </div>

    <div class="form-group">
      <label>Description (optional)</label>
      <input type="text" id="campDesc" placeholder="Brief description" />
    </div>

    <div class="form-group">
      <label>Upload contacts CSV</label>
      <div class="upload-area" id="uploadArea" onclick="document.getElementById('csvFile').click()">
        <div id="uploadText">Click to upload CSV file</div>
        <div style="font-size:12px;margin-top:4px;color:#9ca3af">Must include: callee_name, mobile_number columns</div>
      </div>
      <input type="file" id="csvFile" accept=".csv" style="display:none" onchange="handleFile(this)" />
    </div>

    <div style="font-size:12px;color:#6b7280;background:#f9fafb;border-radius:8px;padding:12px;margin-bottom:20px">
      ✅ Call results will go directly to n8n:<br>
      <strong style="font-family:monospace">${N8N_WEBHOOK_URL}</strong><br>
      WhatsApp messages will be sent to the caller's number when has_referral = Yes & whatsapp_consent = Yes
    </div>

    <div style="display:flex;align-items:center;gap:12px">
      <button class="btn" id="createBtn" onclick="createCampaign()">Launch Campaign</button>
      <span id="loadingText" style="font-size:13px;color:#6b7280;display:none">Creating campaign…</span>
    </div>
  </div>
</div>

<script>
  function showPage(id, el) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    el.classList.add('active');
    if (id === "campaign") { clearTimeout(refreshTimer); loadAgents(); }
    if (id === "dashboard") { refreshTimer = setTimeout(() => location.reload(), 10000); }
  }

  async function loadAgents() {
    const sel = document.getElementById('agentSelect');
    sel.innerHTML = '<option value="">Loading…</option>';
    try {
      const res  = await fetch('/api/agents');
      const data = await res.json();
      console.log('Agents data:', data);
      if (data.results && data.results.length > 0) {
        sel.innerHTML = '<option value="">Select an agent</option>' +
          data.results.map(a =>
            \`<option value="\${a.id}">\${a.name} — \${a.language}</option>\`
          ).join('');
      } else {
        sel.innerHTML = '<option value="">No agents found — check API key</option>';
      }
    } catch(e) {
      console.error('Agent load error:', e);
      sel.innerHTML = '<option value="">Error loading agents</option>';
    }
  }

  function handleFile(input) {
    const file = input.files[0];
    if (!file) return;
    document.getElementById('uploadArea').classList.add('has-file');
    document.getElementById('uploadText').textContent = '✓ ' + file.name;
  }

  async function createCampaign() {
    const name    = document.getElementById('campName').value.trim();
    const agentId = document.getElementById('agentSelect').value;
    const desc    = document.getElementById('campDesc').value.trim();
    const file    = document.getElementById('csvFile').files[0];

    if (!name)    return showAlert('Please enter a campaign name', 'error');
    if (!agentId) return showAlert('Please select an agent', 'error');
    if (!file)    return showAlert('Please upload a CSV file', 'error');

    const btn     = document.getElementById('createBtn');
    const loading = document.getElementById('loadingText');
    btn.disabled  = true;
    loading.style.display = 'inline';

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('data', JSON.stringify({ name, agent_id: agentId, description: desc }));

      const res    = await fetch('/api/campaigns', { method: 'POST', body: formData });
      const result = await res.json();

      if (result.success) {
        showAlert('🎉 Campaign launched! Calls starting shortly. Results will flow to n8n automatically.', 'success');
        document.getElementById('campName').value = '';
        document.getElementById('campDesc').value = '';
        document.getElementById('csvFile').value  = '';
        document.getElementById('uploadArea').classList.remove('has-file');
        document.getElementById('uploadText').textContent = 'Click to upload CSV file';
      } else {
        showAlert('Error: ' + JSON.stringify(result.error), 'error');
      }
    } catch(e) {
      showAlert('Something went wrong: ' + e.message, 'error');
    }

    btn.disabled = false;
    loading.style.display = 'none';
  }

  function showAlert(msg, type) {
    const box = document.getElementById('alertBox');
    box.innerHTML = \`<div class="alert alert-\${type}">\${msg}</div>\`;
    setTimeout(() => box.innerHTML = '', 8000);
  }

  window.refreshTimer = setTimeout(() => location.reload(), 10000);
</script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Running on port ${PORT} | API key set: ${!!hunar_va_live_sk_qAqRT3I9aggsuLNFgf-VdVXI3kLobALJmAfQpb-yWIi_uOLZbkC7IQ}`));
