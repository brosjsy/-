(() => {
  const tenantSelect = document.getElementById('tenant-select');
  const statusTenant = document.getElementById('status-tenant');
  const statusPlan = document.getElementById('status-plan');
  const statusUsage = document.getElementById('status-usage');
  const usageFill = document.getElementById('usage-fill');
  const banner = document.getElementById('banner');
  const createForm = document.getElementById('create-form');
  const titleInput = document.getElementById('title');
  const descInput = document.getElementById('description');
  const createButton = createForm.querySelector('button');
  const ticketsEl = document.getElementById('tickets');
  const emptyState = document.getElementById('empty-state');

  function token() {
    return tenantSelect.value;
  }

  function authHeaders(extra) {
    return { Authorization: `Bearer ${token()}`, ...extra };
  }

  function showBanner(message, kind) {
    banner.textContent = message;
    banner.className = `banner ${kind}`;
    banner.hidden = false;
  }

  function hideBanner() {
    banner.hidden = true;
  }

  function renderStatus(data) {
    statusTenant.textContent = data.tenantName;
    statusPlan.textContent = data.plan === 'pro' ? 'Pro' : 'Free';
    statusUsage.textContent = `${data.openCount} / ${data.limit}`;
    const pct = Math.min(100, Math.round((data.openCount / data.limit) * 100));
    usageFill.style.width = pct + '%';
    usageFill.classList.toggle('full', data.openCount >= data.limit);
    createButton.disabled = data.openCount >= data.limit;
    createButton.textContent = data.openCount >= data.limit ? 'Plan limit reached' : 'Create ticket';
  }

  function renderTickets(tickets) {
    ticketsEl.innerHTML = '';
    emptyState.hidden = tickets.length > 0;
    for (const t of tickets) {
      const row = document.createElement('div');
      row.className = `ticket ${t.status}`;
      row.innerHTML = `
        <div class="ticket-main">
          <div class="ticket-title">${escapeHtml(t.title)}</div>
          ${t.description ? `<div class="ticket-desc">${escapeHtml(t.description)}</div>` : ''}
          <div class="ticket-meta">#${t.id} · created ${new Date(t.createdAt).toLocaleString()}</div>
        </div>
        <span class="ticket-tag ${t.status}">${t.status}</span>
        ${t.status === 'open' ? `<button data-close="${t.id}">Close</button>` : ''}
      `;
      ticketsEl.appendChild(row);
    }
    ticketsEl.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeTicket(btn.getAttribute('data-close')));
    });
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function refresh() {
    const res = await fetch('/tickets', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) {
      showBanner(data.message || 'Failed to load tickets', 'err');
      return;
    }
    renderStatus(data);
    renderTickets(data.tickets);
  }

  async function closeTicket(id) {
    const res = await fetch(`/tickets/${id}/close`, { method: 'PATCH', headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) {
      showBanner(data.message || 'Failed to close ticket', 'err');
      return;
    }
    hideBanner();
    await refresh();
  }

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    const res = await fetch('/tickets', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title, description: descInput.value.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      showBanner(data.message || 'Could not create ticket', 'err');
      return;
    }
    hideBanner();
    titleInput.value = '';
    descInput.value = '';
    await refresh();
  });

  tenantSelect.addEventListener('change', () => {
    hideBanner();
    refresh();
  });

  refresh();
})();
