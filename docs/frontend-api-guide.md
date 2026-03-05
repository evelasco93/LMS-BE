# Frontend Guide: LMS Campaigns, Participants, and Leads

This doc summarizes how the LMS API behaves so the frontend can model the UI. API reference source: [api/openapi.json](api/openapi.json).

## High-level flow

- Create client(s) and affiliate(s).
- Create a campaign (starts DRAFT).
- Link at least one client and one affiliate to the campaign. Linking an affiliate returns a `campaign_key` used for all lead submissions from that affiliate. **Linking always sets participant status to TEST.**
- Move campaign to TEST once both client and affiliate are linked. Participant status starts as TEST; change to LIVE via participant update endpoints.
- Optionally flip participant statuses (TEST ↔ LIVE or DISABLED) via participant update endpoints.
- Move campaign to ACTIVE only when campaign is currently TEST and it has at least one LIVE client and one LIVE affiliate (DISABLED participants are ignored for the LIVE requirement).
- Campaigns now include `plugins` configuration. By default, `plugins.duplicate_check.enabled=true` with criteria `phone` and `email`.
- Rotate keys if compromised: use the new key rotation endpoints to issue a fresh `campaign_key` for an affiliate or `client_key` for a linked client.
- Deletion safeguards: campaigns can only be deleted in DRAFT/TEST when empty and without leads; clients/affiliates must be disabled in all campaigns before soft delete and cannot be hard deleted when campaigns have leads.
- Internal API is protected by Bearer token auth — call `POST /v2/auth/login` to get a token, then send `Authorization: Bearer <id_token>` on all internal API requests. **Use `id_token`, not `access_token`** — the API Gateway Cognito authorizer validates ID tokens.
- External lead intake is a separate API Gateway with POST-only routes. No API key required — the `campaign_id` and `campaign_key` in the request body serve as authentication.

## Entities and statuses

- Client status: ACTIVE, INACTIVE, SUSPENDED. **Soft-deleting a client automatically sets status to INACTIVE.**
- Affiliate status: ACTIVE, INACTIVE. **Soft-deleting an affiliate automatically sets status to INACTIVE.**
- Campaign participant status: TEST, LIVE, DISABLED (per linked client/affiliate inside the campaign).
- Campaign status: DRAFT → TEST → ACTIVE.

### Audit fields (present on every Client, Affiliate, Campaign, and Lead)

Every entity now carries the following audit and soft-delete fields:

| Field          | Type                                   | Description                                                    |
| -------------- | -------------------------------------- | -------------------------------------------------------------- |
| `created_by`   | RequestActor                           | Identity that created the record                               |
| `updated_by`   | RequestActor \| null                   | Identity that last mutated the record                          |
| `deleted_by`   | RequestActor \| null                   | Identity that soft-deleted the record; `null` when not deleted |
| `deleted_at`   | ISO timestamp \| null                  | When the soft-delete occurred; `null` when not deleted         |
| `is_deleted`   | boolean                                | `true` when soft-deleted                                       |
| `active`       | boolean                                | Convenience inverse of `is_deleted` (`false` when deleted)     |
| `edit_history` | array (Client/Affiliate/Lead/Campaign) | Ordered log of field-level changes; see below.                 |

Use `active` / `is_deleted` in the UI to show/hide deleted records without re-fetching.

### API error handling note

All endpoints **always return HTTP 200**, including business-logic rejections. Check the `success` field in the response body:

```json
{ "success": false, "error": "Campaign is in test mode; send to /lead/test" }
```

Only network or Gateway-level failures return non-200 status codes (e.g. 401 for an invalid/missing Bearer token, 403 for an unregistered route).

## Endpoint walkthrough (key payloads)

Examples assume base `https://.../v2`.

- Internal API base (dev): `https://3ifu8b0q2h.execute-api.us-east-1.amazonaws.com/dev/v2`
- External leads API base (dev): `https://uj580pu31h.execute-api.us-east-1.amazonaws.com/dev/v2`

**Create client** `POST /clients`

```json
{
  "name": "Acme Corp",
  "email": "ops@acme.com",
  "phone": "+15551234567",
  "client_code": "ACME-001"
}
```

Response returns the client with `id` and timestamps.

**Create affiliate** `POST /affiliates`

```json
{
  "name": "Growth Partners",
  "email": "contact@growth.io",
  "phone": "+15559876543",
  "affiliate_code": "GROW-99"
}
```

**Update client** `PUT /clients/{id}`

All fields optional — only supplied fields are updated. Every changed field is automatically appended to `edit_history`.

```json
{ "name": "New Name", "phone": "+15550001111", "status": "INACTIVE" }
```

**Update affiliate** `PUT /affiliates/{id}`

Same pattern — all fields optional. Changed fields recorded in `edit_history`.

```json
{ "name": "Updated Partner", "company": "New Co", "status": "INACTIVE" }
```

**Edit history (clients, affiliates, leads, campaigns)**

Every `PUT` to a client, affiliate, lead, or campaign records a history entry per changed field. The `edit_history` array on each object grows with each update and is never truncated.

```json
"edit_history": [
  {
    "field": "name",
    "previous_value": "Old Name",
    "new_value": "New Name",
    "changed_at": "2026-03-04T18:00:00.000Z",
    "changed_by": {
      "sub": "...",
      "username": "edgar@summitedgelegal.com",
      "email": "edgar@summitedgelegal.com",
      "first_name": "Edgar",
      "last_name": "Velasco",
      "full_name": "Edgar Velasco"
    }
  }
]
```

- Client tracks: `name`, `email`, `phone`, `client_code`, `status`
- Affiliate tracks: `name`, `email`, `phone`, `company`, `affiliate_code`, `status`
- Lead tracks: every key inside `payload` (e.g. `payload.name`, `payload.email`)
- Campaign tracks: `name`

Note: `edit_history` is **read-only** from the frontend perspective — never send it in a PUT request body.

**Create campaign** `POST /campaigns`

```json
{ "name": "Spring Promo" }
```

Starts as `status=DRAFT`.

**Link client to campaign** `POST /campaigns/{id}/clients` (always TEST)

```json
{
  "client_id": "CLABC12345"
}
```

Adds `added_at` on the participant record.

**Link affiliate to campaign** `POST /campaigns/{id}/affiliates` (always TEST; returns `campaign_key`)

```json
{
  "affiliate_id": "AFABC12345"
}
```

Returns `campaign_key` plus updated campaign; affiliate participant also records `added_at`.

**Update linked participant status**

- Client: `PUT /campaigns/{id}/clients/{clientId}`
- Affiliate: `PUT /campaigns/{id}/affiliates/{affiliateId}`

```json
{ "status": "LIVE" }
```

Valid values: TEST, LIVE, DISABLED. Use these endpoints to move participants from TEST to LIVE (or disable); links always start in TEST.

**Update campaign name** `PUT /campaigns/{id}`

```json
{ "name": "Spring Promo (v2)" }
```

**Rotate affiliate campaign_key** `POST /campaigns/{id}/affiliates/{affiliateId}/rotate-key`

Returns updated campaign plus a new `campaign_key` for that affiliate. Use when a key is compromised or rotated as part of a security review.

**Remove linked participant**

- Client: `DELETE /campaigns/{id}/clients/{clientId}`
- Affiliate: `DELETE /campaigns/{id}/affiliates/{affiliateId}`
  Removal is blocked when the campaign has leads; disable the participant instead. Removal writes a history entry (`removed_clients` / `removed_affiliates`) with timestamps and keys.

**Participant change history**

Every linked client and affiliate object contains a `history` array that is appended to automatically by the backend — the frontend never writes to it directly. Each entry records exactly what changed, who changed it, and when.

| `event`          | When it is written                                                          | `field`        |
| ---------------- | --------------------------------------------------------------------------- | -------------- |
| `linked`         | Initial link or re-link via `POST /campaigns/{id}/clients` or `/affiliates` | `status`       |
| `status_changed` | `PUT /campaigns/{id}/clients/{id}` or `/affiliates/{id}`                    | `status`       |
| `key_rotated`    | `POST /campaigns/{id}/affiliates/{affiliateId}/rotate-key`                  | `campaign_key` |

Example participant object returned from any campaign endpoint:

```json
{
  "affiliate_id": "AFABC12345",
  "campaign_key": "abc123xyz789",
  "added_at": "2026-03-01T10:00:00.000Z",
  "status": "LIVE",
  "history": [
    {
      "event": "linked",
      "field": "status",
      "from": null,
      "to": "TEST",
      "changed_at": "2026-03-01T10:00:00.000Z",
      "changed_by": { "username": "edgar@example.com" }
    },
    {
      "event": "status_changed",
      "field": "status",
      "from": "TEST",
      "to": "LIVE",
      "changed_at": "2026-03-02T09:15:00.000Z",
      "changed_by": { "username": "edgar@example.com" }
    },
    {
      "event": "key_rotated",
      "field": "campaign_key",
      "from": "oldkey000001",
      "to": "abc123xyz789",
      "changed_at": "2026-03-03T14:30:00.000Z",
      "changed_by": { "username": "edgar@example.com" }
    }
  ]
}
```

The same structure applies to `clients[]` entries — they track `linked` and `status_changed` events only (clients have no rotatable key).

**Get campaign by id** `GET /campaigns/{id}`

Returns the full campaign object including participants (with `history`), plugins, status history, and all audit fields.

**Delete campaign** `DELETE /campaigns/{id}` (soft) · `DELETE /campaigns/{id}?permanent=true` (hard)

Allowed only in DRAFT/TEST and only when the campaign has no linked clients/affiliates and no leads. Hard-delete is allowed only if the campaign never had participants or leads; otherwise, only soft-delete is permitted.

Soft-delete (default): sets `is_deleted=true`, `active=false`, records `deleted_by` + `deleted_at`.
Hard-delete: permanently removes the record from DynamoDB — irreversible.

Response:

```json
{
  "success": true,
  "message": "Campaign soft-deleted successfully",
  "data": { "id": "CMABC12345", "permanent": false }
}
```

**Soft-delete and hard-delete** — applies to clients, affiliates, campaigns, and leads

All `DELETE /{resource}/{id}` endpoints support two modes:

| Mode                    | URL                                   | What happens                                                                                                                           |
| ----------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Soft-delete (default)   | `DELETE /clients/{id}`                | Sets `is_deleted=true`, `active=false`, records `deleted_by` + `deleted_at`. Record is hidden from normal queries but still in the DB. |
| Hard-delete (permanent) | `DELETE /clients/{id}?permanent=true` | Permanently removes the record from DynamoDB. Irreversible.                                                                            |

Response shape for all delete endpoints:

```json
{
  "success": true,
  "message": "Client soft-deleted successfully",
  "data": { "id": "CLABC12345", "permanent": false }
}
```

`permanent: true` → hard-deleted (gone). `permanent: false` → soft-deleted (recoverable).

**Listing with soft-deleted records** — add `?includeDeleted=true` to any list endpoint:

- `GET /clients?includeDeleted=true`
- `GET /affiliates?includeDeleted=true`
- `GET /campaigns?includeDeleted=true`
- `GET /leads?includeDeleted=true`

Soft-deleted records have `is_deleted: true` and `active: false`. Use `active` to quickly filter in your frontend state.

```json
{ "status": "TEST" } // or "ACTIVE"
```

Rules:

- To TEST: requires at least one linked client and one linked affiliate.
- To ACTIVE: campaign must already be TEST, at least one LIVE client and one LIVE affiliate, and no participants remaining in TEST (DISABLED allowed but do not count as LIVE).

**Update campaign plugins** `PUT /campaigns/{id}/plugins`

```json
{
  "duplicate_check": {
    "enabled": true,
    "criteria": ["email"]
  }
}
```

Rules:

- `duplicate_check.enabled` toggles duplicate detection during lead intake.
- `duplicate_check.criteria` supports `phone` and/or `email`.
- `duplicate_check.enabled=true` requires at least one active criterion (`phone` or `email`).
- When `duplicate_check.enabled=true`, duplicate matches are stored with `duplicate=true` and are marked `rejected=true` with a duplicate-check rejection reason.
- When `duplicate_check.enabled=false`, duplicate-check does not reject leads.

**Submit test lead (external API)** `POST /leads/test`

```json
{
  "campaign_id": "CMABCDEFG",
  "campaign_key": "123456789012",
  "payload": { "email": "lead@test.com", "name": "Test Lead" }
}
```

Requirements: campaign status TEST; affiliate participant status TEST; `campaign_key` matches the affiliate’s key.
**Submit live lead (external API)** `POST /leads`

```json
{
  "campaign_id": "CMABCDEFG",
  "campaign_key": "123456789012",
  "payload": { "email": "lead@example.com", "name": "Live Lead" }
}
```

Requirements: campaign status ACTIVE; affiliate participant status LIVE; `campaign_key` matches. If the affiliate is DISABLED, the lead is stored with `rejected=true`, `rejection_reason`, and `affiliate_status_at_intake`.

No API key required — authentication is entirely via `campaign_id` + `campaign_key`.
**Internal lead reads/updates/deletes (internal API only)**

- `GET /leads` — list all leads; supports `?campaign_id`, `?test`, `?includeDeleted=true`, `?limit`, `?lastEvaluatedKey`
- `GET /leads/{id}` — get single lead
- `PUT /leads/{id}` — update lead payload
- `DELETE /leads/{id}` — soft-delete; `DELETE /leads/{id}?permanent=true` for hard-delete

`POST /leads` and `POST /leads/test` are intentionally **not** exposed on the internal API.

**Lead shape** (response `data`)

```json
{
  "id": "LDABC12345",
  "campaign_id": "CMABCDEFG",
  "campaign_key": "123456789012",
  "test": true,
  "payload": { "email": "..." },
  "duplicate": false,
  "duplicate_matches": { "lead_ids": [] },
  "affiliate_status_at_intake": "TEST",
  "rejected": false,
  "rejection_reason": null,
  "created_at": "2024-01-01T00:00:00Z",
  "created_by": "123456789012",
  "updated_by": null,
  "deleted_by": null,
  "deleted_at": null,
  "is_deleted": false,
  "active": true
}
```

Rejection behavior:

- `rejected=true` when affiliate is DISABLED for the campaign.
- `rejected=true` when duplicate-check is enabled and a duplicate is detected.
- `rejected=false` when neither condition applies.

## UI hints

- Show campaign status plus per-participant statuses; allow toggling participant status via the participant PUT endpoints.
- Surface `campaign_key` to affiliates once linked; they need it for both test and live lead intake.
- When sending leads, display backend message and `rejected` flag to make DISABLED affiliate behavior clear.
- Display duplicate metadata: `duplicate=true` means lead matched existing campaign leads; use `duplicate_matches.lead_ids` to show linked duplicates.
- Only enable “Activate campaign” when the rules above are satisfied (LIVE participants present, none left in TEST).- **Edit history**: display `edit_history` in a collapsible timeline on client, affiliate, lead, and campaign detail views. Each entry shows `field`, `previous_value → new_value`, `changed_at`, and `changed_by.full_name` (or fall back to `changed_by.email`).
- **Soft-delete UI**: use `active` (boolean) to control visibility. Show a "deleted" badge or hide the row when `active=false`. Offer a restore action that calls `PUT /users/{id}/enable` (users) or a future restore endpoint for other entities.
- **Audit trail**: display `created_by` and `updated_by` in detail views / tooltips. Show `deleted_by` + `deleted_at` in soft-deleted record summaries.
- **All responses are HTTP 200** — check `success` (boolean) in the body, not the HTTP status, to determine if an operation succeeded. On `success: false`, display the `error` field to the user.

## Internal login

The internal API uses custom Bearer token auth backed by Cognito. No OAuth redirects or hosted UI needed — your login screen calls the backend directly.

### Login

`POST /v2/auth/login` — no Authorization header needed on this call.

```json
{
  "email": "user@example.com",
  "password": "UserPassword1!"
}
```

Response:

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "access_token": "eyJ...",
    "id_token": "eyJ...",
    "refresh_token": "eyJ...",
    "expires_in": 3600,
    "token_type": "Bearer"
  }
}
```

- Store `id_token` and `refresh_token` (e.g. in memory / httpOnly cookie).
- Send `Authorization: Bearer <id_token>` on every internal API call. **Important: use `id_token`, not `access_token`** — the API Gateway Cognito authorizer validates ID tokens.
- `id_token` expires in 1 hour by default.

### Token refresh

`POST /v2/auth/refresh` — call before the access_token expires or when you receive a 401.

```json
{ "refresh_token": "<refresh_token from login>" }
```

Response is the same shape as login (`data.access_token`, `data.id_token`, `data.expires_in`). No new `refresh_token` is issued on refresh; use the original.

### Error handling

- `401` with `success: false` means invalid credentials or expired/invalid token.
- On 401 from any protected endpoint: try `/v2/auth/refresh`; if that also returns 401, redirect to login.

### Notes

- Cognito User Pool ID and Client ID are server-side details managed by the backend. The frontend does **not** need them.
- Do **not** implement the Cognito hosted UI, OAuth redirect, or PKCE flow — the custom login endpoint replaces all of that.

## Frontend dev env values (current)

Minimal values needed for frontend integration:

```dotenv
VITE_INTERNAL_API_BASE_URL=https://3ifu8b0q2h.execute-api.us-east-1.amazonaws.com/dev/v2
VITE_EXTERNAL_LEADS_API_BASE_URL=https://uj580pu31h.execute-api.us-east-1.amazonaws.com/dev/v2
```

The internal API URL already includes `/v2`. The external API URL also includes `/v2`. No API keys or Cognito OAuth URLs are needed on the frontend.

> **Login credentials** are managed server-side (Cognito User Pool). Use `POST /v2/users` (admin only) or `scripts/create-cognito-user.sh` to provision users. The frontend only needs email + password for the login form — it calls `POST /v2/auth/login` and stores the returned `id_token`.

## Helper scripts

- Full flow smoke test (interactive): [scripts/test-api.sh](scripts/test-api.sh)
  - Menu-driven: choose auth / clients / affiliates / campaigns / all
  - Non-interactive: `./scripts/test-api.sh --suite=auth`
  - Auth suite: logs in, validates token grants access to `GET /leads`, validates requests without a token get 401
- Interactive lead-only helper: [scripts/send-lead.sh](scripts/send-lead.sh)
  - Usage: `./scripts/send-lead.sh https://your-api/dev/v2`
  - Prompts for campaign_id, campaign_key, lead type (test/live), and payload JSON; prints HTTP status and response body.
- Frontend auth/API handoff values: [scripts/get-auth-values.sh](scripts/get-auth-values.sh)
  - Usage:
    - `source ./scripts/env-dev.sh`
    - `./scripts/get-auth-values.sh`
  - Prints copy/paste values for frontend `.env` (internal and external API base URLs).
- Cognito user provisioning: [scripts/create-cognito-user.sh](scripts/create-cognito-user.sh)
  - Usage:
    - `source ./scripts/env-dev.sh`
    - `./scripts/create-cognito-user.sh --email dev1@company.com --password 'StrongPass123!'`
  - Creates (or updates) the user in the internal API user pool and sets permanent password.

## User management (admin only)

All `/v2/users` endpoints require an admin Bearer token (`id_token` from an account in the Cognito `admin` group). Staff users receive a `403 Forbidden`.

### Roles

- `admin` — full access including all user management endpoints.
- `staff` — can access all other internal API endpoints; cannot manage users.

Role is included in the `cognito:groups` claim of the `id_token`. New users default to `staff` if no role is specified.

### Create user

`POST /v2/users` — creates a Cognito user with a permanent password and assigns the role group. The `role` field is **required for UI** so you can offer a dropdown of `staff`/`admin` when building your form; if omitted the backend defaults to `staff`.

```json
{
  "email": "jane@example.com",
  "password": "TempPass1!",
  "firstName": "Jane",
  "lastName": "Doe",
  "role": "staff" // "admin" or "staff"
}
```

Returns `201` with the new user object. `role` defaults to `staff` if omitted.

### List users

`GET /v2/users` — returns all Cognito users with their assigned role.

### Get user

`GET /v2/users/{id}` — where `{id}` is the URL-encoded email/username. E.g. `jane%40example.com`.

### Update user (role and/or name)

`PUT /v2/users/{id}` — all fields are optional; include only what you want to change.

**Role only** (`admin` or `staff`):

```json
{ "role": "admin" }
```

**Name only:**

```json
{ "firstName": "Edgar", "lastName": "Velasco" }
```

**Both at once:**

```json
{ "role": "staff", "firstName": "Jane", "lastName": "Doe" }
```

At least one field must be present. Fields not included are left unchanged.

> **Role change note:** After changing a user's role, they must re-login to receive a fresh `id_token` with the updated `cognito:groups` claim. Name changes take effect immediately — no re-login needed.

### Reset password

`PUT /v2/users/{id}/password` — sets a new permanent password without requiring the current one.

```json
{ "password": "NewPass1!" }
```

### Disable user (soft-delete)

`DELETE /v2/users/{id}` — disables the Cognito account (`AdminDisableUser`). The account is preserved but the user cannot log in. `enabled` on the user object becomes `false`.

### Re-enable user

`PUT /v2/users/{id}/enable` — re-enables a previously disabled account (`AdminEnableUser`). No request body needed. Returns the updated user object with `enabled: true`.

### Delete user (permanent)

There is no permanent user delete endpoint; `DELETE /v2/users/{id}` is always a soft-disable.

### User object shape

```json
{
  "username": "jane@example.com",
  "email": "jane@example.com",
  "firstName": "Jane",
  "lastName": "Doe",
  "status": "CONFIRMED",
  "enabled": true,
  "role": "staff",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

> **Navbar tip:** Use `firstName` + `lastName` for the welcome message and derive initials from their first characters (`firstName[0] + lastName[0]`). Both fields are optional — fall back to the `email` prefix if either is absent.

## Tenant settings (Secrets Manager-backed)

Settings endpoints for managing provider credentials are available under `tenant-config`.

- `GET /tenant-config/credentials` → list configured provider credentials
- `GET /tenant-config/credentials/{provider}` → get one provider config
- `PUT /tenant-config/credentials` → create/update provider config
- `DELETE /tenant-config/credentials/{provider}` → remove provider config

Supported credential types:

- `api_key`: `credentials.apiKey`
- `basic_auth`: `credentials.username` + `credentials.password`
- `bearer_token`: `credentials.token`

Recommended providers to store:

- `ipqs` (`api_key`) for duplicate check integrations
- `trusted_forms` (`basic_auth`) for Trusted Forms auth

Example: IPQS

```json
{
  "provider": "ipqs",
  "type": "api_key",
  "credentials": {
    "apiKey": "YOUR_IPQS_API_KEY"
  }
}
```

Example: Trusted Forms

```json
{
  "provider": "trusted_forms",
  "type": "basic_auth",
  "credentials": {
    "username": "YOUR_USERNAME",
    "password": "YOUR_PASSWORD"
  }
}
```

Security note:

- Internal API uses Cognito-backed JWT Bearer auth. Obtain a token via `POST /v2/auth/login` and include it as `Authorization: Bearer <token>` on all internal API requests.
- External leads API is isolated to POST-only intake routes. No API key required.
