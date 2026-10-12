const $ = (id) => document.getElementById(id);

const state = {
  page: 1,
  totalPages: 1,
  currentDetail: null,
  autoRefreshTimer: null,
};

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request gagal (${res.status})`);
  return json;
}

function toast(message, type = 'info') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast toast-${type}`;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2500);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Disalin ke clipboard', 'success');
  } catch {
    toast('Gagal menyalin', 'error');
  }
}

function formatDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('id-ID');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function prettyBody(body, contentType) {
  if (body == null || body === '') return '(kosong)';
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {}
  if ((contentType || '').includes('application/x-www-form-urlencoded')) {
    return JSON.stringify(Object.fromEntries(new URLSearchParams(body)), null, 2);
  }
  return body;
}

function methodBadge(method) {
  const span = document.createElement('span');
  span.className = `badge badge-${method.toLowerCase()}`;
  span.textContent = method;
  return span;
}

function cell(content, className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  if (content instanceof Node) td.append(content);
  else td.textContent = content ?? '-';
  return td;
}

async function loadList() {
  const params = new URLSearchParams({
    page: state.page,
    limit: $('filter-limit').value,
    q: $('filter-q').value,
    method: $('filter-method').value,
  });

  try {
    const data = await api(`/admin/api/requests?${params}`);
    state.totalPages = data.totalPages;
    if (state.page > data.totalPages) {
      state.page = data.totalPages;
      return loadList();
    }

    const rows = $('rows');
    rows.replaceChildren(
      ...data.items.map((item) => {
        const tr = document.createElement('tr');
        tr.addEventListener('click', () => openDetail(item.id));
        const preview =
          item.body_encoding === 'base64'
            ? `[binary ${formatBytes(item.body_size)}]`
            : item.body_preview || '';
        tr.append(
          cell(String(item.id), 'muted'),
          cell(formatDate(item.created_at), 'nowrap'),
          cell(methodBadge(item.method)),
          cell(item.path, 'mono'),
          cell(item.content_type, 'mono small'),
          cell(item.ip, 'mono small'),
          cell(preview, 'mono small truncate'),
        );
        return tr;
      }),
    );

    $('empty-state').hidden = data.items.length > 0;
    $('page-info').textContent = `Halaman ${data.page} dari ${data.totalPages} - total ${data.total} data`;
    $('btn-prev').disabled = data.page <= 1;
    $('btn-next').disabled = data.page >= data.totalPages;
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function openDetail(id) {
  try {
    const { item } = await api(`/admin/api/requests/${id}`);
    state.currentDetail = item;

    $('detail-id').textContent = `#${item.id}`;
    const meta = $('detail-meta');
    meta.replaceChildren();
    const fields = [
      ['Waktu', formatDate(item.created_at)],
      ['Method', item.method],
      ['Path', item.path],
      ['Content-Type', item.content_type || '-'],
      ['IP', item.ip || '-'],
      ['Ukuran body', `${formatBytes(item.body_size)}${item.body_encoding === 'base64' ? ' (binary, base64)' : ''}`],
    ];
    for (const [label, value] of fields) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      meta.append(dt, dd);
    }

    $('detail-body').textContent =
      item.body_encoding === 'base64' ? item.body : prettyBody(item.body, item.content_type);
    $('detail-query').textContent = JSON.stringify(item.query, null, 2);
    $('detail-headers').textContent = JSON.stringify(item.headers, null, 2);
    $('detail-dialog').showModal();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function setAutoRefresh(enabled) {
  clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = enabled ? setInterval(loadList, 5000) : null;
}

let searchTimer;
$('filter-q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.page = 1;
    loadList();
  }, 300);
});
for (const id of ['filter-method', 'filter-limit']) {
  $(id).addEventListener('change', () => {
    state.page = 1;
    loadList();
  });
}
$('auto-refresh').addEventListener('change', (e) => setAutoRefresh(e.target.checked));
$('btn-refresh').addEventListener('click', loadList);
$('btn-prev').addEventListener('click', () => {
  if (state.page > 1) {
    state.page -= 1;
    loadList();
  }
});
$('btn-next').addEventListener('click', () => {
  if (state.page < state.totalPages) {
    state.page += 1;
    loadList();
  }
});

$('btn-delete-all').addEventListener('click', async () => {
  if (!confirm('Hapus SEMUA data history? Tindakan ini tidak bisa dibatalkan.')) return;
  try {
    const { deleted } = await api('/admin/api/requests', { method: 'DELETE' });
    toast(`${deleted} data dihapus`, 'success');
    state.page = 1;
    loadList();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('btn-delete-one').addEventListener('click', async () => {
  const item = state.currentDetail;
  if (!item || !confirm(`Hapus data #${item.id}?`)) return;
  try {
    await api(`/admin/api/requests/${item.id}`, { method: 'DELETE' });
    $('detail-dialog').close();
    toast('Data dihapus', 'success');
    loadList();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('btn-copy-body').addEventListener('click', () => copyText($('detail-body').textContent));

const endpointUrl = `${window.location.origin}/api/receive`;
$('endpoint-url').textContent = endpointUrl;
$('btn-copy-endpoint').addEventListener('click', () => copyText(endpointUrl));

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}

const passwordForm = $('password-form');
$('btn-change-password').addEventListener('click', () => {
  passwordForm.reset();
  $('password-error').hidden = true;
  $('password-success').hidden = true;
  $('password-dialog').showModal();
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = $('password-error');
  const successBox = $('password-success');
  errorBox.hidden = true;
  successBox.hidden = true;

  const { currentPassword, newPassword, confirmPassword } = Object.fromEntries(
    new FormData(passwordForm),
  );
  if (newPassword !== confirmPassword) {
    errorBox.textContent = 'Konfirmasi password tidak sama';
    errorBox.hidden = false;
    return;
  }

  try {
    await api('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    passwordForm.reset();
    successBox.textContent = 'Password berhasil diganti';
    successBox.hidden = false;
    setTimeout(() => $('password-dialog').close(), 1200);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
});

$('btn-logout').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/login';
});

api('/auth/me')
  .then(({ user }) => ($('current-user').textContent = user.username))
  .catch(() => {});
loadList();
