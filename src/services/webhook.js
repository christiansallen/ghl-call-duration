const crypto = require("crypto");
const store = require("./store");
const ghl = require("./ghl");

// GHL's public key for webhook signature verification
// https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide
const GHL_WEBHOOK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSC
Frm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6
dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfB
csedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpvu
xmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF3
kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKUJ
062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXpI
ocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzNh
/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhCH
ULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJP
Qe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAykT
1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`;

function verifyWebhookSignature(rawBody, signatureHeader) {
  try {
    const verifier = crypto.createVerify("SHA256");
    verifier.update(rawBody);
    verifier.end();
    return verifier.verify(GHL_WEBHOOK_PUBLIC_KEY, signatureHeader, "base64");
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return false;
  }
}

async function processCallEvent(payload) {
  if (payload.messageType !== "CALL") return;

  const locationId = payload.locationId;
  if (!locationId) {
    console.error("Call event missing locationId");
    return;
  }

  const triggers = store.getTriggersByLocation(locationId);
  if (triggers.length === 0) return;

  const eventData = {
    callDuration: payload.callDuration ?? 0,
    callStatus: payload.callStatus || payload.status || "unknown",
    direction: payload.direction || "unknown",
    contactId: payload.contactId || null,
    from: payload.from || null,
    to: payload.to || null,
    conversationId: payload.conversationId || null,
    messageId: payload.messageId || null,
    dateAdded: payload.dateAdded || new Date().toISOString(),
    locationId,
  };

  console.log(
    `Processing call event for location ${locationId}: ` +
      `duration=${eventData.callDuration}s, status=${eventData.callStatus}, ` +
      `${triggers.length} trigger(s) to fire`
  );

  const results = await Promise.allSettled(
    triggers.map((trigger) =>
      ghl.fireTrigger(trigger.targetUrl, locationId, eventData)
    )
  );

  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(
        `Failed to fire trigger ${triggers[i].id}:`,
        result.reason?.message || result.reason
      );
    }
  });
}

module.exports = { verifyWebhookSignature, processCallEvent };
