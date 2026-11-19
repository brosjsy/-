'use strict';
const express = require('express');
const path = require('path');

// ---------------------------------------------------------------------------
// Tenant directory (synthetic test data / "test credentials").
// In a real system these tokens would be issued at signup and stored hashed;
// here they are fixed so the acceptance checks are reproducible.
// ---------------------------------------------------------------------------
const PLANS = {
  free: { openTicketLimit: 5 },
  pro: { openTicketLimit: 50 },
};

const TENANTS_BY_TOKEN = {
  'tenantA-token-free': { id: 'tenantA', name: 'Acme Repairs', plan: 'free' },
  'tenantB-token-pro': { id: 'tenantB', name: 'Bolt Electronics', plan: 'pro' },
};

// ---------------------------------------------------------------------------
// Storage: in-memory, keyed by tenant id. Every record carries its owning
// tenant id and is only ever read/written through that key.
// ---------------------------------------------------------------------------
let nextTicketId = 1;
/** @type {Record<string, {id:number, tenantId:string, title:string, description:string, status:'open'|'closed', createdAt:string}[]>} */
const ticketsByTenant = {};
for (const tenant of Object.values(TENANTS_BY_TOKEN)) {
  ticketsByTenant[tenant.id] = [];
}

function openTicketCount(tenantId) {
  return ticketsByTenant[tenantId].filter((t) => t.status === 'open').length;
}

// ---------------------------------------------------------------------------
// Auth middleware: the server derives the tenant from the bearer token only.
// Nothing supplied by the client in the URL, query, or body can change which
// tenant's data is read or written.
// ---------------------------------------------------------------------------
function requireTenant(req, res, next) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match && match[1];
  const tenant = token && TENANTS_BY_TOKEN[token];
  if (!tenant) {
    return res.status(401).json({ error: 'unauthorized', message: 'missing or invalid bearer token' });
  }
  req.tenant = tenant;
  next();
}

const app = express();
app.use(express.json());

// Health check (no tenant required).
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Static GUI assets (public/) are served without a tenant token; the token
// is supplied by the browser on each API call made from the page.
app.use(express.static(path.join(__dirname, 'public')));

app.use(requireTenant);

// List this tenant's own tickets, plus its plan allowance so a client can
// show usage without hardcoding plan limits of its own.
app.get('/tickets', (req, res) => {
  const limit = PLANS[req.tenant.plan].openTicketLimit;
  res.json({
    tenant: req.tenant.id,
    tenantName: req.tenant.name,
    plan: req.tenant.plan,
    limit,
    openCount: openTicketCount(req.tenant.id),
    tickets: ticketsByTenant[req.tenant.id],
  });
});

// Create a ticket for this tenant, enforcing the plan's open-ticket allowance.
app.post('/tickets', (req, res) => {
  const { title, description } = req.body || {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'title is required' });
  }

  const limit = PLANS[req.tenant.plan].openTicketLimit;
  const openCount = openTicketCount(req.tenant.id);
  if (openCount >= limit) {
    return res.status(403).json({
      error: 'plan_limit_reached',
      message: `${req.tenant.plan} plan allows at most ${limit} open tickets; close one before creating another`,
      openCount,
      limit,
    });
  }

  const ticket = {
    id: nextTicketId++,
    tenantId: req.tenant.id,
    title,
    description: description || '',
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  ticketsByTenant[req.tenant.id].push(ticket);
  res.status(201).json(ticket);
});

// Fetch a single ticket. A ticket belonging to another tenant is reported
// as not found, so its existence is never revealed to the wrong tenant.
app.get('/tickets/:id', (req, res) => {
  const id = Number(req.params.id);
  const ticket = ticketsByTenant[req.tenant.id].find((t) => t.id === id);
  if (!ticket) {
    return res.status(404).json({ error: 'not_found', message: 'no ticket with that id for this tenant' });
  }
  res.json(ticket);
});

// Close a ticket owned by this tenant (frees one unit of the plan allowance).
app.patch('/tickets/:id/close', (req, res) => {
  const id = Number(req.params.id);
  const ticket = ticketsByTenant[req.tenant.id].find((t) => t.id === id);
  if (!ticket) {
    return res.status(404).json({ error: 'not_found', message: 'no ticket with that id for this tenant' });
  }
  ticket.status = 'closed';
  res.json(ticket);
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`queuedesk listening on :${PORT}`));
}

module.exports = app;
