# Practical Work 6 — Build and Demonstrate: QueueDesk

This report records the containerised build of QueueDesk and the three
required acceptance checks run against it, with actual request/response
evidence. Source: this repository (`queuedesk/`), `Dockerfile`, `server.js`.
Design reference: `practical-work-5-design-brief.md`.

This revision re-ran every check end-to-end against a freshly started
container, plus extra validation beyond the three required checks (missing/
invalid auth, a bad request, and that closing a ticket frees allowance).
A full-page screenshot of the live run (captured from a real browser making
same-origin `fetch()` calls against the running container) is at
[`evidence/queuedesk-full-run.png`](evidence/queuedesk-full-run.png), and the
raw curl transcript is at [`evidence/full-run.txt`](evidence/full-run.txt).

## 1. Build and start

```
$ docker build -t queuedesk .
...
=> exporting to image
=> naming to docker.io/library/queuedesk
$ docker run -d --rm --name queuedesk -p 3000:3000 queuedesk
$ curl http://localhost:3000/health
{"status":"ok"}
```

(See the README's "Notes on running the build in this environment" for how
the image was verified inside this report's sandboxed build host, without
changing the shipped `Dockerfile`.)

## 2. Seeding / test credentials

No separate seed step is required: tenants and their plans are fixed test
data in `server.js` (`TENANTS_BY_TOKEN`), and tickets are created through the
workflow itself during the checks below.

| Tenant | Token | Plan | Open-ticket limit |
|---|---|---|---|
| Acme Repairs (`tenantA`) | `tenantA-token-free` | free | 5 |
| Bolt Electronics (`tenantB`) | `tenantB-token-pro` | pro | 50 |

## 3. Extra validation (beyond the three required checks)

| Request | Result | Note |
|---|---|---|
| `GET /tickets` with no `Authorization` header | `401 unauthorized` | tenant cannot be derived, request rejected |
| `GET /tickets` with a made-up token | `401 unauthorized` | token must match a real tenant |
| `POST /tickets` with no `title` | `400 bad_request` | server-side validation |
| `PATCH /tickets/1/close` then `POST /tickets` again (Tenant A at its limit) | ticket closes (`status:"closed"`), next create returns `201` | confirms the allowance is on **open** tickets, not a lifetime cap |

See the screenshot and `evidence/full-run.txt` for the exact request/response
pairs.

## 4. Check 1 — Normal use

**Expected:** both tenants complete the workflow (create + list) on their
own data, each seeing only its own ticket.

**Requests and responses:**

```
POST /tickets  (Authorization: Bearer tenantA-token-free)
  body: {"title":"Printer jammed","description":"Front desk printer"}
  -> 201 {"id":1,"tenantId":"tenantA","title":"Printer jammed",
          "description":"Front desk printer","status":"open",
          "createdAt":"2026-11-19T08:25:26.958Z"}

POST /tickets  (Authorization: Bearer tenantB-token-pro)
  body: {"title":"Laptop wont boot","description":"Customer drop-off"}
  -> 201 {"id":2,"tenantId":"tenantB","title":"Laptop wont boot",
          "description":"Customer drop-off","status":"open",
          "createdAt":"2026-11-19T08:25:26.965Z"}

GET /tickets  (Authorization: Bearer tenantA-token-free)
  -> 200 {"tenant":"tenantA","plan":"free",
          "tickets":[{"id":1,"tenantId":"tenantA","title":"Printer jammed",...}]}

GET /tickets  (Authorization: Bearer tenantB-token-pro)
  -> 200 {"tenant":"tenantB","plan":"pro",
          "tickets":[{"id":2,"tenantId":"tenantB","title":"Laptop wont boot",...}]}
```

**Actual vs expected:** matches. Each tenant's list contains exactly the one
ticket it created and nothing from the other tenant. **PASS.**

## 5. Check 2 — Tenant isolation

**Expected:** B creates a record; A's request for it is rejected; B can
still access it, unchanged.

**Requests and responses** (continuing from Check 1 — B's ticket has
`id: 2`):

```
GET /tickets/2  (Authorization: Bearer tenantA-token-free)
  -> 404 {"error":"not_found","message":"no ticket with that id for this tenant"}

GET /tickets/2  (Authorization: Bearer tenantB-token-pro)
  -> 200 {"id":2,"tenantId":"tenantB","title":"Laptop wont boot",
          "description":"Customer drop-off","status":"open",
          "createdAt":"2026-11-19T08:25:26.965Z"}
```

**Actual vs expected:** matches. A's request for B's record is rejected with
`404` (existence of the record is not revealed), and B's own subsequent
request for the same record succeeds and is unchanged. **PASS.**

## 6. Check 3 — Plan limit

**Expected:** A reaches its allowance, its next attempt fails with no change
in count, and B succeeds at the higher count.

**Requests and responses** (Tenant A already had 1 open ticket from Check 1;
four more were created to reach its limit of 5):

```
POST /tickets x4  (Authorization: Bearer tenantA-token-free)
  -> 201, 201, 201, 201   (open count now 5, at the free-plan limit)

POST /tickets  (Authorization: Bearer tenantA-token-free)
  body: {"title":"Issue 6 - should fail"}
  -> 403 {"error":"plan_limit_reached",
          "message":"free plan allows at most 5 open tickets; close one before creating another",
          "openCount":5,"limit":5}

GET /tickets  (Authorization: Bearer tenantA-token-free)
  -> tickets.length == 5   (unchanged by the rejected attempt)

POST /tickets x5  (Authorization: Bearer tenantB-token-pro)
  -> 201, 201, 201, 201, 201   (open count now 6, above the free-plan limit
                                 of 5, which does not apply to Tenant B)

GET /tickets  (Authorization: Bearer tenantB-token-pro)
  -> tickets.length == 6
```

**Actual vs expected:** matches. Tenant A's sixth creation attempt is
rejected with `403 plan_limit_reached` and its open-ticket count stays at 5;
Tenant B, on the pro plan, succeeds in going past 5 open tickets (the limit
that bounds the free plan). **PASS.**

## 7. Summary

| Check | Expected | Actual | Result |
|---|---|---|---|
| Normal use | Each tenant sees only its own ticket | Confirmed | PASS |
| Tenant isolation | A is rejected on B's record; B unaffected | Confirmed (`404`, no leak) | PASS |
| Plan limit | A blocked at 5, count unchanged; B passes 5 | Confirmed (`403`, count stays 5; B reaches 6) | PASS |
| No / invalid token | `401 unauthorized` | Confirmed on both cases | PASS |
| Missing required field | `400 bad_request` | Confirmed | PASS |
| Allowance freed on close | Closing a ticket lets a tenant at its limit create one more | Confirmed (`201` after close) | PASS |

All 6 runs above are visible together in
[`evidence/queuedesk-full-run.png`](evidence/queuedesk-full-run.png).

## 8. Changes made during implementation (vs. the Practical Work 5 design)

- The design brief's `403`/"exists but is not yours" idea for cross-tenant
  access was intentionally implemented as a plain `404` instead, so that a
  tenant cannot distinguish "this id belongs to someone else" from "this id
  never existed" — a stricter form of the same isolation guarantee, noted
  explicitly in the brief's architecture section.
- Storage was implemented as an in-memory per-tenant map rather than a
  database, since the exercise uses synthetic data and values are not
  required to survive a restart; the partitioning principle
  (`ticketsByTenant[tenantId]`) is the same one a real database schema
  (`tickets.tenant_id` with a `WHERE tenant_id = :tenant` filter on every
  query) would enforce.
- No other functional changes from the design brief.
