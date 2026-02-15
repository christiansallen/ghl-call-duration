const express = require("express");
const config = require("./config");
const ghl = require("./services/ghl");
const store = require("./services/store");
const {
  verifyWebhookSignature,
  processCallEvent,
} = require("./services/webhook");

const app = express();

// Parse JSON with raw body capture for webhook signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// --- Health check ---

app.get("/", (_req, res) => {
  res.json({ status: "ok", app: "ghl-call-duration" });
});

// --- OAuth ---

app.get("/oauth/authorize", (_req, res) => {
  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: `${config.appUrl}/oauth/callback`,
    client_id: config.ghl.clientId,
    scope: "conversations/message.readonly conversations/message.write workflows.readonly",
  });
  res.redirect(
    `https://marketplace.leadconnectorhq.com/oauth/chooselocation?${params}`
  );
});

app.get("/oauth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: "Missing authorization code" });

  try {
    const data = await ghl.exchangeCodeForTokens(code);
    res.json({
      success: true,
      locationId: data.locationId,
      message: "App installed successfully",
    });
  } catch (err) {
    console.error("OAuth callback error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to exchange authorization code" });
  }
});

// --- Trigger subscription lifecycle ---

app.post("/webhooks/trigger", (req, res) => {
  const { triggerData, extras } = req.body;

  if (!triggerData || !extras?.locationId) {
    return res.status(400).json({ error: "Invalid trigger payload" });
  }

  const { locationId, workflowId } = extras;
  const { id, targetUrl, filters } = triggerData;

  // The eventType field may be at triggerData level or top level depending on GHL version
  const eventType = req.body.eventType || triggerData.eventType;

  console.log(
    `Trigger ${eventType}: id=${id}, location=${locationId}, workflow=${workflowId}`
  );

  if (eventType === "CREATED" || eventType === "UPDATED") {
    store.saveTriggerSubscription(locationId, {
      id,
      targetUrl,
      filters: filters || [],
      workflowId,
      createdAt: new Date().toISOString(),
    });
  } else if (eventType === "DELETED") {
    store.removeTriggerSubscription(locationId, id);
  }

  res.status(200).json({ success: true });
});

// --- Call webhook (InboundMessage) ---

app.post("/webhooks/call", (req, res) => {
  const signature = req.headers["x-wh-signature"];

  if (signature && !verifyWebhookSignature(req.rawBody, signature)) {
    console.warn("Webhook signature verification failed");
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Respond immediately — GHL only retries on 429
  res.status(200).json({ received: true });

  // Process async
  processCallEvent(req.body).catch((err) => {
    console.error("Error processing call event:", err);
  });
});

// --- SSO ---

app.post("/sso", (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: "Missing SSO key" });

  try {
    const data = ghl.decryptSSOData(key);
    res.json(data);
  } catch (err) {
    console.error("SSO decryption error:", err.message);
    res.status(400).json({ error: "Invalid SSO key" });
  }
});

// --- Start ---

app.listen(config.port, () => {
  console.log(`GHL Call Duration app running on port ${config.port}`);
  console.log(`OAuth: ${config.appUrl}/oauth/authorize`);
  console.log(`Trigger webhook: ${config.appUrl}/webhooks/trigger`);
  console.log(`Call webhook: ${config.appUrl}/webhooks/call`);
});
