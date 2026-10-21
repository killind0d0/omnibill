# OmniBill Access & Security Architecture

## Server Boundary & Authorization Guard

OmniBill enforces security at the embedded HTTP network server boundary (`guarded_dispatch`).

### Security Architecture Principles:
1. **HTTP Boundary Guarding:**
   - Every external HTTP request arriving at the embedded server must pass through `guarded_dispatch`.
   - The route is looked up in `ROUTES`, which maps 1-to-1 to entries in `COMMAND_POLICY`.
   - Unknown routes immediately fail closed with HTTP 404.
   - For protected routes, authentication requires an `Authorization: Bearer <token>` header. Missing or invalid tokens fail closed with HTTP 401.
   - The verified user's effective permissions and the business license mode (active, read-only, suspended) are evaluated. Unauthorized requests fail closed with HTTP 403.
   - On successful authorization, the request is dispatched to the corresponding `cmd_*` implementation.

2. **Internal API Bypass by Design:**
   - Direct calls to `cmd_*` from internal Rust code, integration test suites, and batch seeding tools constitute the internal API and bypass the network guard by design.
   - This architectural decision guarantees that existing tests and internal subsystems run at native performance with zero overhead while keeping the external network attack surface 100% hardened and authenticated.

3. **Localhost Network Hardening:**
   - Strict `Host` header validation restricts requests strictly to `127.0.0.1:<port>` or `localhost:<port>`, defending against DNS-rebinding attacks.
   - Strict `Origin` allow-listing rejects foreign or untrusted web origins. Wildcard `Access-Control-Allow-Origin: *` is strictly prohibited.
   - All responses include `Cache-Control: no-store`.
   - Maximum body size is strictly limited to 1 MB (1,048,576 bytes).
