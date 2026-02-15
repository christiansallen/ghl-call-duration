# GHL Call Duration - Marketplace App Implementation Plan

## Context

The [GHL feature request](https://ideas.gohighlevel.com/call-tracking/p/call-duration) (286 votes, "Planned") asks for workflow branching based on call duration. GHL doesn't natively support this yet, so we're building a Marketplace app that provides a **custom workflow trigger** exposing call duration data.

**The flow:**
1. User installs app -> OAuth stores tokens
2. User adds "Call Duration" trigger to a workflow -> GHL sends us the `targetUrl`
3. A call completes -> GHL sends InboundMessage webhook to our app (includes `callDuration` in seconds)
4. Our app POSTs call data to each registered `targetUrl` -> workflow branches on duration

## What Exists

| File | Status |
|---|---|
| `src/config.js` | Done - env config |
| `src/services/store.js` | Done - file-based token + trigger storage |
| `package.json` | Done - express, axios, dotenv, crypto-js |
| `.env.example` | Done |
| `src/index.js` | **Missing** |

## Files to Create

### 1. `src/services/ghl.js` — GHL API service

- `exchangeCodeForTokens(code)` — POST to `/oauth/token` with `grant_type=authorization_code`, store tokens by locationId
- `refreshAccessToken(locationId)` — POST with `grant_type=refresh_token`, persist new tokens (GHL refresh tokens are single-use)
- `fireTrigger(targetUrl, locationId, eventData)` — POST call data to the trigger's targetUrl with Bearer token, retry once on 401
- `decryptSSOData(key)` — AES decrypt SSO token using `crypto-js`

### 2. `src/services/webhook.js` — Webhook processing

- `verifyWebhookSignature(rawBody, signature)` — RSA SHA256 verification using GHL's public key via `node:crypto`
- `processCallEvent(payload)` — Filter for `messageType === "CALL"`, build event data, fire all triggers for the locationId via `Promise.allSettled()`

### 3. `src/index.js` — Express server (main entry point)

Routes:
- `GET /` — Health check
- `GET /oauth/authorize` — Redirect to GHL OAuth consent screen
- `GET /oauth/callback` — Exchange auth code for tokens, store them
- `POST /webhooks/trigger` — Handle trigger lifecycle (CREATED/UPDATED/DELETED), store/remove targetUrls
- `POST /webhooks/call` — Verify signature, respond 200 immediately, process call event async
- `POST /sso` — Decrypt SSO token for embedded settings UI

Key middleware: `express.json()` with `verify` callback to capture raw body for signature verification.

## Event Data Payload (sent to workflows)

```json
{
  "callDuration": 145,
  "callStatus": "completed",
  "direction": "inbound",
  "contactId": "abc123",
  "from": "+15551234567",
  "to": "+15559876543",
  "conversationId": "conv123",
  "messageId": "msg123",
  "dateAdded": "2026-02-14T12:00:00.000Z",
  "locationId": "loc123"
}
```

This lets workflow users branch on conditions like "callDuration > 60" or "callStatus == voicemail".

## Implementation Order

1. `npm install`
2. Create `src/services/ghl.js` (no deps on other new files)
3. Create `src/services/webhook.js` (depends on ghl.js + store.js)
4. Create `src/index.js` (wires everything together)
5. Init git repo

## Design Decisions

- **Respond 200 before processing** — GHL only retries on 429; async processing avoids timeouts
- **Lazy token refresh** — Refresh on 401 instead of scheduled cron (matches official GHL template pattern)
- **File-based storage** — Already chosen in store.js, fine for MVP
- **Signature verification optional in dev** — Skip if `x-wh-signature` header absent, always verify when present

## Verification

1. `npm run dev` — starts with `node --watch`
2. `curl localhost:3000/` — health check
3. Mock POST to `/webhooks/trigger` with CREATED payload — verify trigger stored in `data/triggers.json`
4. Mock POST to `/webhooks/call` with call payload — verify trigger fired
5. Full OAuth flow requires ngrok + real GHL marketplace app credentials
