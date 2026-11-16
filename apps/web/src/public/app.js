const app = document.getElementById('app');
const nav = document.getElementById('nav');
const who = document.getElementById('who');

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else if (value !== false && value != null) el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (res.status === 401 && path !== '/api/login' && path !== '/api/me') {
    await start();
    throw new Error('Please sign in again');
  }
  if (!res.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data;
}

const message = (text, kind = 'error') => h('p', { class: kind, role: kind === 'error' ? 'alert' : 'status' }, text);
const field = (label, name, attrs = {}) => h('label', {}, label, h('input', { name, ...attrs }));
const formData = (form) => Object.fromEntries(new FormData(form).entries());

function show(...nodes) {
  app.replaceChildren(...nodes);
}

function authForm({ title, button, onSubmit, withName }) {
  const out = h('div');
  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await onSubmit(formData(form));
        } catch (error) {
          out.replaceChildren(message(error.message));
        }
      },
    },
    h('h2', {}, title),
    field('Username', 'username', { required: true, autocomplete: 'username' }),
    withName ? field('Display name', 'displayName', { required: true }) : null,
    field('Password', 'password', { type: 'password', required: true, autocomplete: withName ? 'new-password' : 'current-password' }),
    h('button', { type: 'submit' }, button),
    out,
  );
  return form;
}

async function start() {
  nav.hidden = true;
  const { needsSetup } = await api('GET', '/api/setup');
  if (needsSetup) {
    show(
      h('p', {}, 'No manager accounts exist yet. Create the first one to begin.'),
      authForm({ title: 'First-time setup', button: 'Create account', withName: true, onSubmit: async (data) => { await api('POST', '/api/setup', data); await home(); } }),
    );
    return;
  }
  try {
    await api('GET', '/api/me');
    await home();
  } catch {
    show(authForm({ title: 'Sign in', button: 'Sign in', onSubmit: async (data) => { await api('POST', '/api/login', data); await home(); } }));
  }
}

async function home() {
  const me = await api('GET', '/api/me');
  who.textContent = `Signed in as ${me.displayName}`;
  nav.hidden = false;
  await showLaptops();
}

document.getElementById('btn-logout').addEventListener('click', async () => {
  await api('POST', '/api/logout');
  await start();
});

document.getElementById('btn-managers').addEventListener('click', showManagers);
document.getElementById('btn-lowstock').addEventListener('click', () => showLowStock());

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');

function table(headers, rows, empty) {
  if (rows.length === 0) return h('p', {}, empty);
  return h('table', {}, h('thead', {}, h('tr', {}, headers.map((t) => h('th', {}, t)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))));
}

async function showLowStock(notice, historyFilter = {}) {
  const hp = new URLSearchParams(Object.entries(historyFilter).filter(([, v]) => v));
  const [levels, alerts, settings, history, report] = await Promise.all([
    api('GET', '/api/low-stock/levels'),
    api('GET', '/api/low-stock/alerts?status=open'),
    api('GET', '/api/low-stock/settings'),
    api('GET', `/api/low-stock/history?${hp}`),
    api('GET', `/api/low-stock/report?${new URLSearchParams([hp.get('from') && ['from', hp.get('from')], hp.get('to') && ['to', hp.get('to')]].filter(Boolean))}`),
  ]);
  const out = h('div');
  const run = async (fn, success) => {
    try {
      await fn();
      await showLowStock(success, historyFilter);
    } catch (error) {
      out.replaceChildren(message(error.message));
    }
  };
  const nameOf = (id) => settings.managers.find((m) => m.id === id)?.displayName ?? id;

  const alertRows = alerts.map((a) => [
    a.skuLabel, a.warehouse, `${a.available} / ${a.threshold}`, a.suggestedReorder,
    a.status + (a.snoozedUntil ? ` (snoozed until ${when(a.snoozedUntil)})` : '') + (a.escalatedAt ? ', escalated' : ''),
    h('div', { class: 'row' },
      h('button', { type: 'button', onclick: () => run(() => api('POST', `/api/low-stock/alerts/${a.id}/acknowledge`), 'Alert acknowledged.') }, 'Acknowledge'),
      h('button', { type: 'button', class: 'secondary', onclick: () => run(() => api('POST', `/api/low-stock/alerts/${a.id}/snooze`, { minutes: 60 }), 'Snoozed for 1 hour.') }, 'Snooze 1h'),
      h('button', { type: 'button', class: 'secondary', onclick: () => run(() => api('POST', `/api/low-stock/alerts/${a.id}/snooze`, { minutes: 1440 }), 'Snoozed for 1 day.') }, 'Snooze 1d')),
  ]);

  const levelRows = levels.map((l) => [
    l.skuLabel, l.warehouse, l.available, l.threshold ?? '—', l.low ? h('span', { class: 'badge' }, 'Low Stock') : '',
    h('button', { type: 'button', class: 'secondary', onclick: () => {
      const f = document.getElementById('threshold-form');
      f.sku.value = l.sku; f.warehouse.value = l.warehouse; f.minQty.value = l.threshold ?? ''; f.minQty.focus();
    } }, 'Set threshold'),
  ]);

  const thresholdForm = h('form', {
    id: 'threshold-form', class: 'inline',
    onsubmit: (e) => {
      e.preventDefault();
      const d = formData(e.target);
      run(() => api('PUT', '/api/low-stock/thresholds', {
        sku: d.sku, warehouse: d.scope === 'sku' ? null : d.warehouse, minQty: Number(d.minQty),
        reorderTarget: d.reorderTarget === '' ? null : Number(d.reorderTarget),
      }), 'Threshold saved.');
    },
  },
    h('input', { type: 'hidden', name: 'sku' }),
    field('Warehouse', 'warehouse', { maxlength: 100 }),
    h('label', {}, 'Applies to', h('select', { name: 'scope' }, h('option', { value: 'warehouse' }, 'This warehouse'), h('option', { value: 'sku' }, 'All warehouses (SKU default)'))),
    field('Minimum stock', 'minQty', { type: 'number', min: 0, step: 1, required: true }),
    field('Reorder up to (optional)', 'reorderTarget', { type: 'number', min: 0, step: 1 }),
    h('button', { type: 'submit' }, 'Save threshold'),
  );

  const managerForms = settings.managers.map((m) => {
    const s = m.settings ?? {};
    const form = h('form', {
      class: 'inline',
      onsubmit: (e) => {
        e.preventDefault();
        const d = formData(form);
        run(() => api('PUT', `/api/low-stock/settings/${m.id}`, {
          designated: d.designated === 'on', email: d.email, slack: d.slack, teams: d.teams, sms: d.sms,
          secondaryAccountId: d.secondaryAccountId,
        }), `Alert settings saved for ${m.displayName}.`);
      },
    },
      h('strong', {}, m.displayName),
      h('label', {}, h('input', { type: 'checkbox', name: 'designated', checked: s.designated === true }), ' Receives alerts'),
      field('Email', 'email', { type: 'email', value: s.email ?? '' }),
      field('Slack webhook (optional)', 'slack', { value: s.slack ?? '' }),
      field('Teams webhook (optional)', 'teams', { value: s.teams ?? '' }),
      field('SMS number (optional)', 'sms', { value: s.sms ?? '' }),
      h('label', {}, 'Escalate to', h('select', { name: 'secondaryAccountId' }, h('option', { value: '' }, 'Nobody'),
        settings.managers.filter((o) => o.id !== m.id).map((o) => h('option', { value: o.id, selected: o.id === s.secondaryAccountId }, o.displayName)))),
      h('button', { type: 'submit' }, 'Save'),
    );
    return form;
  });

  const configForm = h('form', {
    class: 'inline',
    onsubmit: (e) => {
      e.preventDefault();
      run(() => api('PUT', '/api/low-stock/config', { escalationMinutes: Number(formData(e.target).escalationMinutes) }), 'Escalation period saved.');
    },
  },
    field('Escalate if not acknowledged within (minutes)', 'escalationMinutes', { type: 'number', min: 1, max: 10080, step: 1, required: true, value: settings.config.escalationMinutes }),
    h('button', { type: 'submit' }, 'Save'));

  const filterForm = h('form', {
    class: 'inline',
    onsubmit: (e) => { e.preventDefault(); showLowStock(undefined, formData(e.target)); },
  },
    field('SKU', 'sku', { value: historyFilter.sku ?? '' }),
    field('Warehouse', 'warehouse', { value: historyFilter.warehouse ?? '' }),
    field('From', 'from', { type: 'date', value: historyFilter.from ?? '' }),
    field('To', 'to', { type: 'date', value: historyFilter.to ?? '' }),
    h('button', { type: 'submit' }, 'Filter'));

  show(
    h('h2', {}, 'Low stock'),
    notice && message(notice, 'notice'),
    out,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'secondary', onclick: () => showLaptops() }, 'Back to laptops')),
    h('h3', {}, 'Open alerts'),
    table(['SKU', 'Warehouse', 'Available / threshold', 'Suggested reorder', 'Status', ''], alertRows, 'No open alerts.'),
    h('h3', {}, 'Stock levels and thresholds'),
    table(['SKU', 'Warehouse', 'Available', 'Threshold', '', ''], levelRows, 'No laptops yet.'),
    thresholdForm,
    h('h3', {}, 'Alert recipients'),
    configForm,
    managerForms,
    h('h3', {}, 'Alert history'),
    filterForm,
    table(['Time', 'SKU', 'Warehouse', 'Recipient', 'Channel', 'Status', 'Delivery'],
      history.slice(0, 200).map((e) => [when(e.at), e.skuLabel, e.warehouse, nameOf(e.recipientId), e.channel, e.status, e.delivery + (e.note ? ` (${e.note})` : '')]),
      'No alerts match.'),
    h('h3', {}, 'Low-stock frequency'),
    table(['SKU', 'Low-stock events'], report.map((r) => [r.skuLabel, r.count]), 'No low-stock events in this range.'),
  );
}

function showManagers() {
  const out = h('div');
  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const created = await api('POST', '/api/accounts', formData(form));
          form.reset();
          out.replaceChildren(message(`Manager ${created.username} created. They can sign in now.`, 'notice'));
        } catch (error) {
          out.replaceChildren(message(error.message));
        }
      },
    },
    h('h2', {}, 'Add manager'),
    field('Username (3 to 50 characters)', 'username', { required: true, minlength: 3, maxlength: 50 }),
    field('Display name', 'displayName', { required: true, maxlength: 100 }),
    field('Password (at least 8 characters)', 'password', { type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }),
    h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Create manager'), h('button', { type: 'button', class: 'secondary', onclick: showLaptops }, 'Back to laptops')),
    out,
  );
  show(form);
}

const LAPTOP_FIELDS = [
  ['Brand', 'brand', { required: true, maxlength: 100 }],
  ['Model', 'model', { required: true, maxlength: 100 }],
  ['Serial number', 'serialNumber', { required: true, maxlength: 100 }],
  ['Purchase date', 'purchaseDate', { type: 'date', required: true }],
  ['Processor', 'processor', { maxlength: 100 }],
  ['Memory', 'memory', { maxlength: 100 }],
  ['Storage', 'storage', { maxlength: 100 }],
];

function laptopForm({ title, submitLabel, values = {}, onSubmit, onCancel }) {
  const out = h('div');
  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        const d = formData(form);
        try {
          await onSubmit({
            brand: d.brand, model: d.model, serialNumber: d.serialNumber, purchaseDate: d.purchaseDate,
            specs: { processor: d.processor, memory: d.memory, storage: d.storage },
            warehouse: d.warehouse, reserved: d.reserved === 'on', defective: d.defective === 'on',
          });
        } catch (error) {
          out.replaceChildren(message(error.message));
        }
      },
    },
    h('h3', {}, title),
    LAPTOP_FIELDS.map(([label, name, attrs]) => {
      const value = values[name] ?? values.specs?.[name] ?? '';
      return field(label, name, { ...attrs, value });
    }),
    field('Warehouse (default: Main)', 'warehouse', { maxlength: 100, value: values.warehouse ?? '' }),
    h('label', {}, h('input', { type: 'checkbox', name: 'reserved', checked: values.reserved === true }), ' Reserved'),
    h('label', {}, h('input', { type: 'checkbox', name: 'defective', checked: values.defective === true }), ' Defective'),
    h('div', { class: 'row' }, h('button', { type: 'submit' }, submitLabel), onCancel && h('button', { type: 'button', class: 'secondary', onclick: onCancel }, 'Cancel')),
    out,
  );
  return form;
}

async function showLaptops(filters) {
  const f = { q: filters?.q ?? '', status: filters?.status ?? '' };
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.status) params.set('status', f.status);
  const [laptops, summary] = await Promise.all([
    api('GET', `/api/laptops${params.size ? `?${params}` : ''}`),
    api('GET', '/api/summary'),
  ]);
  const addHost = h('div');
  const filterForm = h(
    'form',
    {
      class: 'inline',
      onsubmit: (e) => {
        e.preventDefault();
        const d = formData(e.target);
        showLaptops({ q: d.q.trim(), status: d.status });
      },
    },
    field('Search (brand, model, serial number, holder)', 'q', { type: 'search', value: f.q }),
    h('label', {}, 'Status', h('select', { name: 'status' },
      [['', 'All'], ['Available', 'Available'], ['Assigned', 'Assigned'], ['InRepair', 'In repair'], ['Retired', 'Retired']]
        .map(([value, label]) => h('option', { value, selected: value === f.status }, label)))),
    h('button', { type: 'submit' }, 'Search'),
    (f.q || f.status) && h('button', { type: 'button', class: 'secondary', onclick: () => showLaptops() }, 'Clear'),
  );
  const filtered = f.q || f.status;
  const table = laptops.length === 0
    ? h('p', {}, filtered ? 'No laptops found.' : 'No laptops yet. Add the first one.')
    : h(
        'table',
        {},
        h('thead', {}, h('tr', {}, ['Brand', 'Model', 'Serial number', 'Status', 'Holder', ''].map((t) => h('th', {}, t)))),
        h(
          'tbody',
          {},
          laptops.map((l) =>
            h(
              'tr',
              {},
              h('td', {}, l.brand),
              h('td', {}, l.model),
              h('td', {}, l.serialNumber),
              h('td', {}, h('span', { class: 'badge' }, l.status)),
              h('td', {}, l.currentHolder ?? ''),
              h('td', {}, h('button', { type: 'button', class: 'secondary', onclick: () => showDetails(l.id) }, 'Details')),
            ),
          ),
        ),
      );
  show(
    h('h2', {}, 'Laptops'),
    h('div', { class: 'summary', 'aria-label': 'Laptops per status' },
      [['Total', summary.total], ['Available', summary.Available], ['Assigned', summary.Assigned], ['In repair', summary.InRepair], ['Retired', summary.Retired]]
        .map(([label, count]) => h('div', {}, h('strong', {}, count), ` ${label}`))),
    filterForm,
    h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => {
      addHost.replaceChildren(laptopForm({
        title: 'Add laptop', submitLabel: 'Add laptop',
        onSubmit: async (data) => { await api('POST', '/api/laptops', data); await showLaptops(); },
        onCancel: () => addHost.replaceChildren(),
      }));
    } }, 'Add laptop')),
    addHost,
    table,
  );
}

async function runAction(id, action, success) {
  try {
    await action();
    await showDetails(id, success);
  } catch (error) {
    const host = document.getElementById('detail-form');
    host.replaceChildren(message(error.message));
  }
}

function detailActions(l) {
  const buttons = [
    h('button', { type: 'button', class: 'secondary', onclick: () => {
      document.getElementById('detail-form').replaceChildren(laptopForm({
        title: 'Edit laptop', submitLabel: 'Save changes', values: l,
        onSubmit: async (data) => { await api('PATCH', `/api/laptops/${l.id}`, data); await showDetails(l.id, 'Changes saved.'); },
        onCancel: () => document.getElementById('detail-form').replaceChildren(),
      }));
    } }, 'Edit details'),
  ];
  if (l.status === 'Available') {
    buttons.push(h('button', {
      type: 'button',
      onclick: () => {
        document.getElementById('detail-form').replaceChildren(h(
          'form',
          {
            onsubmit: (e) => {
              e.preventDefault();
              const { personName } = formData(e.target);
              runAction(l.id, () => api('POST', `/api/laptops/${l.id}/assign`, { personName }), `Assigned to ${personName}.`);
            },
          },
          h('h3', {}, 'Assign laptop'),
          field('Person name', 'personName', { required: true, maxlength: 100 }),
          h('button', { type: 'submit' }, 'Assign'),
        ));
      },
    }, 'Assign'));
  }
  if (l.status === 'Assigned') {
    buttons.push(h('button', {
      type: 'button',
      onclick: () => runAction(l.id, () => api('POST', `/api/laptops/${l.id}/return`), 'Laptop returned.'),
    }, `Record return from ${l.currentHolder}`));
  }
  const setStatus = (status, label, confirmText) =>
    h('button', {
      type: 'button', class: status === 'Retired' ? 'danger' : 'secondary',
      onclick: () => {
        if (confirmText && !confirm(confirmText)) return;
        runAction(l.id, () => api('POST', `/api/laptops/${l.id}/status`, { status }), `Status changed to ${status}.`);
      },
    }, label);
  if (l.status === 'Available') buttons.push(setStatus('InRepair', 'Send to repair'));
  if (l.status === 'InRepair') buttons.push(setStatus('Available', 'Mark repaired (Available)'));
  if (l.status === 'Available' || l.status === 'InRepair') {
    buttons.push(setStatus('Retired', 'Retire', 'Retiring is permanent and cannot be undone. Continue?'));
  }
  if (l.assignments.length === 0) {
    buttons.push(h('button', {
      type: 'button', class: 'danger',
      onclick: async () => {
        if (!confirm('Delete this laptop and its change history permanently?')) return;
        try {
          await api('DELETE', `/api/laptops/${l.id}`);
          await showLaptops();
        } catch (error) {
          document.getElementById('detail-form').replaceChildren(message(error.message));
        }
      },
    }, 'Delete'));
  } else {
    buttons.push(h('span', {}, 'Cannot be deleted: it has assignment history. Retire it instead.'));
  }
  return h('div', { class: 'row' }, buttons);
}

async function showDetails(id, notice) {
  const l = await api('GET', `/api/laptops/${id}`);
  show(
    h('button', { type: 'button', class: 'secondary', onclick: showLaptops }, 'Back to list'),
    h('h2', {}, `${l.brand} ${l.model}`),
    notice && message(notice, 'notice'),
    h('p', {}, h('span', { class: 'badge' }, l.status), l.currentHolder ? ` held by ${l.currentHolder}` : ''),
    detailActions(l),
    h('div', { id: 'detail-form' }),
    h('dl', {},
      h('dt', {}, 'Serial number'), h('dd', {}, l.serialNumber),
      h('dt', {}, 'Purchase date'), h('dd', {}, l.purchaseDate),
      h('dt', {}, 'Processor'), h('dd', {}, l.specs.processor ?? '-'),
      h('dt', {}, 'Memory'), h('dd', {}, l.specs.memory ?? '-'),
      h('dt', {}, 'Storage'), h('dd', {}, l.specs.storage ?? '-'),
    ),
    h('h3', {}, 'Assignment history'),
    l.assignments.length === 0
      ? h('p', {}, 'Never assigned.')
      : h('ul', {}, l.assignments.map((a) => h('li', {}, `${a.personName}: ${a.assignedAt}${a.returnedAt ? ` to ${a.returnedAt}` : ' (current)'}`))),
    h('h3', {}, 'Change history'),
    h('ul', {}, l.history.map((c) => h('li', {}, `${c.at} - ${c.byName}: ${c.action} (${c.detail})`))),
  );
}

start();
