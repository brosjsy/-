# Practical Work 5 — Design Brief: QueueDesk

## 1. The idea

QueueDesk is a shared support-ticket tracker for small, independent service
businesses — for example two unaffiliated computer-repair shops — that need
a simple place to log and resolve customer issues but have no interest in
running their own servers. Both businesses use the same deployed application
and the same database; the recurring problem is "we need lightweight ticket
tracking without the cost or effort of operating separate infrastructure,"
and QueueDesk solves it as a multi-tenant service. The paid allowance is the
number of **open** tickets a business can have at once: the free plan caps a
tenant at 5 concurrently open tickets, while the pro plan raises that to 50,
so a growing shop pays to handle more simultaneous work rather than for a
feature it may never touch.

## 2. End-to-end workflow

A support agent at a tenant business:

1. **Creates a ticket** for an incoming customer issue (`title`,
   `description`). The ticket is stored with `status: "open"`.
2. **Lists open/closed tickets** to see the business's current workload.
3. **Opens a single ticket** by id to review its details.
4. **Closes the ticket** once the issue is resolved, which frees one unit of
   that tenant's open-ticket allowance.

Records stored: one `ticket` record per issue —
`{ id, tenantId, title, description, status, createdAt }` — kept in a
per-tenant collection so every record carries the tenant that owns it.

## 3. Architecture and tenant isolation

```
 ┌───────────────┐                              ┌───────────────┐
 │  Tenant A      │                              │  Tenant B      │
 │  (Acme Repairs)│                              │  (Bolt         │
 │  free plan     │                              │   Electronics) │
 │                │                              │   pro plan     │
 └──────┬────────┘                              └──────┬────────┘
        │  HTTPS + Bearer token A                      │  HTTPS + Bearer token B
        ▼                                              ▼
 ┌──────────────────────────────────────────────────────────────┐
 │                    QueueDesk application                      │
 │  (single Express process, one Docker container)                │
 │                                                                  │
 │   auth middleware: Bearer token → tenant record (id, plan)      │
 │   route handlers: every read/write is scoped to req.tenant.id   │
 └───────────────────────────┬──────────────────────────────────┘
                              ▼
                 ┌─────────────────────────────┐
                 │   Storage (per-tenant store)  │
                 │   ticketsByTenant[tenantId]    │
                 │   tenantA: [...]  tenantB: [...] │
                 └─────────────────────────────┘
```

Both tenants call the same running application and the same storage; there
is one deployed instance, not one per customer.

**How the server identifies the tenant:** every request (other than the
health check) must carry `Authorization: Bearer <token>`. An auth middleware
looks the token up in a server-side tenant directory and attaches the
resulting `{id, name, plan}` to the request as `req.tenant`. The tenant id is
never taken from the URL, a query parameter, or the request body — only from
the verified token — so a client cannot simply ask for a different tenant's
id and be served its data.

**How access is limited to the tenant's own records:** storage is
partitioned by tenant id (`ticketsByTenant[tenantId]`), and every handler
reads and writes only its own partition — `ticketsByTenant[req.tenant.id]`.
Looking up a ticket by id first filters to the caller's own partition, so a
ticket id that exists only under another tenant is indistinguishable from an
id that doesn't exist at all: the server returns `404`, never a
`403`/"exists but is not yours," which would otherwise leak the existence of
other tenants' records.

## 4. Plans

| Plan | Measurable limit | Action it gates | Enforcement | What the customer sees at the limit |
|---|---|---|---|---|
| **Free** | 5 concurrently open tickets | Creating a new ticket (`POST /tickets`) | Before inserting, the server counts the tenant's tickets with `status: "open"`; if the count is already at the plan's limit, the ticket is not created | `403 Forbidden`, `{"error":"plan_limit_reached","message":"free plan allows at most 5 open tickets; close one before creating another","openCount":5,"limit":5}` |
| **Pro** | 50 concurrently open tickets | Creating a new ticket (`POST /tickets`) | Same check, higher limit | Same shape of response once 50 is reached |

Closing a ticket (`PATCH /tickets/:id/close`) reduces the open count, which
frees capacity for a new one — the limit is on concurrent open work, not a
lifetime cap, so a tenant that keeps up with its tickets never hits it.

## 5. Acceptance checks

**AC1 — Normal use.** *Starting condition:* tenants A and B both have zero
tickets. *Action:* A creates a ticket and lists its tickets; B creates a
different ticket and lists its tickets. *Expected result:* A's list
contains exactly the one ticket it created; B's list contains exactly the
one ticket it created; neither list contains the other tenant's ticket.

**AC2 — Cross-tenant access attempt.** *Starting condition:* B has created a
ticket with id `N`. *Action:* A requests `GET /tickets/N` using its own
valid token. *Expected result:* A receives `404 Not Found` (no data about
B's ticket is revealed), and a subsequent `GET /tickets/N` by B still
returns the ticket, unchanged.

**AC3 — Plan limit.** *Starting condition:* tenant A (free plan) already has
4 open tickets; tenant B (pro plan) has 4 open tickets. *Action:* A creates
one more ticket (reaching 5), then attempts a sixth; B creates a sixth
ticket. *Expected result:* A's fifth creation succeeds (now at its limit of
5); A's sixth attempt fails with `403 plan_limit_reached` and A's open count
remains 5; B's sixth creation succeeds, since B's limit is 50.
