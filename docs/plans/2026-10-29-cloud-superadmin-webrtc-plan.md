# Cloud Super Admin & In-App WebRTC Remote Assistance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an enterprise multi-tenant subscription SaaS management platform that allows the Super Admin to distribute OmniBill to external businesses, collect subscription payments automatically via payment gateway webhooks, enforce multi-counter hardware limits, and remotely assist clients in real-time via 1-click in-app WebRTC screen-sharing.

**Architecture:** 
1. Central Rust Control-Plane backend (`control-plane/`) running an HTTP API + WebSocket WebRTC signaling server.
2. Web Control-Plane frontend (`control-plane/web/`) providing the master Super Admin dashboard, automated billing, and live support cockpit.
3. Client-side POS integration (`ui/src/` and `src-tauri/`) introducing a 1-click `Live Support` WebRTC video emitter and automated license check-in.

**Tech Stack:** Rust 2024, Actix/Axum/Hyper HTTP + WebSocket, SQLite WAL, React 19, TypeScript 5.7, Tailwind CSS, WebRTC (peer-to-peer encrypted DTLS-SRTP), Razorpay/Stripe Webhooks.

---

### Scope

- **In Scope:**
  - Automated Payment Gateway Webhook handler (`/v1/webhooks/razorpay`) with cryptographic ed25519 license extension.
  - In-app payment renewal modal & WhatsApp payment link generator for expiring clients.
  - WebRTC signaling hub (WebSocket relay) connecting Super Admin browser to Client POS.
  - Client-side 1-click "Live Support" screen-share emitter in OmniBill POS.
  - Super Admin Live Support Cockpit with embedded real-time video player and remote diagnostic actions.
  - Hardware device fingerprinting and counter capacity enforcement.
  - Multi-tenant tenant directory with vertical filters (Retail, Wholesale, School, Hospital).
- **Out of Scope:**
  - Modifying the local store zero-float accounting engine (local databases remain 100% offline-first).
  - Installing third-party remote desktop software (no TeamViewer or AnyDesk dependencies).

---

### Task 1: Automated Payment Gateway Webhook Engine

**Files:**
- Modify: `control-plane/src/payments.rs`
- Modify: `control-plane/src/routes.rs`
- Create: `control-plane/tests/payment_webhook.rs`

**Objectives:**
- Validate HMAC-SHA256 signature from Razorpay / Cashfree / Stripe.
- Atomically record transaction in `payments` ledger.
- Extend `valid_until_day` on the target tenant record.
- Re-sign tenant license token using the control-plane master ed25519 private key.
- Clear any suspended / grace-period flags automatically.

---

### Task 2: WebRTC Signaling Hub for Remote Support

**Files:**
- Create: `control-plane/src/signaling.rs`
- Modify: `control-plane/src/server.rs`
- Modify: `control-plane/src/routes.rs`
- Create: `control-plane/tests/signaling_e2e.rs`

**Objectives:**
- Implement WebSocket signaling endpoint `/v1/support/ws`.
- Support 3 message types: `Offer`, `Answer`, `ICECandidate`.
- Secure session matching: Support session initiated by client with 6-character PIN; Super Admin connects using PIN.
- Session auto-expiry after 30 minutes of inactivity.

---

### Task 3: Client POS 1-Click "Live Support" WebRTC Integration

**Files:**
- Create: `ui/src/features/support/LiveSupportModal.tsx`
- Create: `ui/src/features/support/webrtcClient.ts`
- Modify: `ui/src/App.tsx` (Add Live Support trigger to header)
- Test: `ui/tests/webrtc_support.test.mjs`

**Objectives:**
- Add `🎧 Live Support` button to global navigation header across all business verticals.
- Implement WebRTC media stream capture (desktop display / active window).
- Generate single-session 6-character connection PIN.
- Provide clear visual indicator `🟢 Screen Shared with HQ` with instant `Disconnect` toggle.

---

### Task 4: Super Admin Live Support Cockpit (Web Dashboard)

**Files:**
- Create: `control-plane/web/src/screens/LiveSupportScreen.tsx`
- Create: `control-plane/web/src/components/WebRTCPlayer.tsx`
- Modify: `control-plane/web/src/screens/TenantDetailScreen.tsx`
- Modify: `control-plane/web/src/App.tsx`

**Objectives:**
- Add "Live Support" tab to Super Admin navigation with badge notification for active client help requests.
- Full-screen high-definition video player displaying client's POS screen.
- Diagnostic side-panel showing: POS version, memory, latency, last bill timestamp, counter ID.
- Quick remote actions: Trigger DB integrity verify, force-refresh license, push price/tax updates.

---

### Task 5: Automated License Check-In & In-App Expiry Banner

**Files:**
- Modify: `src-tauri/src/access/licence.rs`
- Create: `ui/src/features/licensing/ExpiryBanner.tsx`
- Create: `ui/src/features/licensing/RenewalModal.tsx`
- Modify: `ui/src/App.tsx`

**Objectives:**
- Background heartbeat (`checkin`) every 6 hours verifying license validity.
- 7 days before expiry: Non-intrusive top banner with "Renew Now" button.
- Expired (Grace Period): Dismissible warning modal.
- Expired (Lockout): Read-only view enforced, bill creation blocked until renewal webhook confirms payment.

---

### Verification & Testing Milestones

1. **Payment Webhook Verification:** Synthetic webhook triggers license extension and valid signature generation.
2. **Signaling Server Unit Tests:** WebSocket handshake, room creation, and ICE candidate exchange verified.
3. **WebRTC End-to-End Simulation:** Browser client streams video frames successfully to Super Admin receiver.
4. **Counter Gatekeeping Test:** Registering counter N+1 is rejected when plan allows N counters.
5. **Full Cargo & UI Test Suites:** `cargo test` and `npm test` exit with 0 failures.
