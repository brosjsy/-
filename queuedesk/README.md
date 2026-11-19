# QueueDesk

A minimal multi-tenant support-ticket tracker built for Cloud Computing
Practical Work 5–6 ("Design and Build Your Own SaaS"). Two independent
customer organisations (tenants) share one running application and one
storage layer, each seeing only its own tickets and bound by its own plan's
open-ticket allowance.

Reports:
- [`docs/practical-work-5-design-brief.md`](docs/practical-work-5-design-brief.md)
- [`docs/practical-work-6-build-and-test-report.md`](docs/practical-work-6-build-and-test-report.md)

## Stack

Node.js 22 + Express, in-memory per-tenant storage (synthetic data, no
external database needed for this exercise), packaged as a single Docker
image.

## Test tenants (seeded in `server.js`)

| Tenant | Token (`Authorization: Bearer <token>`) | Plan | Open-ticket limit |
|---|---|---|---|
| Acme Repairs (`tenantA`) | `tenantA-token-free` | free | 5 |
| Bolt Electronics (`tenantB`) | `tenantB-token-pro` | pro | 50 |

Tokens are hardcoded test credentials for this exercise, not a real auth
system — see the design brief for how a production version would issue and
verify them.

## Build and run

```bash
docker build -t queuedesk .
docker run -d --rm --name queuedesk -p 3000:3000 queuedesk
curl http://localhost:3000/health   # {"status":"ok"}
```

Each run starts with no tickets; there is no seed step beyond the tenant
directory above, since ticket creation is part of the workflow being tested.

## API

All routes except `/health` require `Authorization: Bearer <token>`. The
tenant is derived solely from that token — nothing in the URL, query string,
or body can select a different tenant.

| Method | Path | Description |
|---|---|---|
| GET | `/tickets` | List the caller's tenant's tickets |
| POST | `/tickets` | Create a ticket for the caller's tenant (`{title, description}`); rejected with `403 plan_limit_reached` once the plan's open-ticket allowance is hit |
| GET | `/tickets/:id` | Fetch one ticket; `404` if it does not belong to the caller's tenant |
| PATCH | `/tickets/:id/close` | Close one of the caller's tenant's tickets, freeing one unit of allowance |

## Making requests as each tenant

```bash
# Tenant A creates a ticket
curl -X POST http://localhost:3000/tickets \
  -H "Authorization: Bearer tenantA-token-free" \
  -H "Content-Type: application/json" \
  -d '{"title":"Printer jammed","description":"Front desk printer"}'

# Tenant A lists its tickets
curl http://localhost:3000/tickets -H "Authorization: Bearer tenantA-token-free"

# Tenant B creates a ticket
curl -X POST http://localhost:3000/tickets \
  -H "Authorization: Bearer tenantB-token-pro" \
  -H "Content-Type: application/json" \
  -d '{"title":"Laptop wont boot","description":"Customer drop-off"}'
```

Full evidence for the three required acceptance checks (normal use, tenant
isolation, plan limit) is in
[`docs/practical-work-6-build-and-test-report.md`](docs/practical-work-6-build-and-test-report.md).

## Notes on running the build in this environment

The Docker build here was verified inside a sandboxed CI-style container
whose build step has no outbound network access (only the host shell's
HTTPS proxy is set up, not the isolated `docker build` network namespace).
To verify the image without changing the shipped `Dockerfile` (a plain
`RUN npm install --omit=dev`, which works normally wherever Docker has
internet access), dependencies were pre-installed on the host with
`npm install --omit=dev` and the resulting `node_modules/` was copied into a
throwaway verification image instead of re-running `npm install` inside the
build. The shipped `Dockerfile` was not changed by this workaround.
