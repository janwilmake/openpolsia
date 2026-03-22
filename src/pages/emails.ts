import { Company, escapeHtml } from "../types";

export function emailsPageHTML(company: Company) {
  const cId = escapeHtml(company.id);
  const cName = escapeHtml(company.name);
  const cSlug = escapeHtml(company.slug);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Emails — ${cName} — Open Polsia</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      color: #111;
      background: #f8f8f8;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .topbar {
      background: #111;
      color: #fff;
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 14px;
      flex-shrink: 0;
    }
    .topbar-left { display: flex; align-items: center; gap: 16px; }
    .topbar h1 { font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; }
    .topbar a { color: #aaa; text-decoration: underline; text-underline-offset: 2px; font-size: 14px; }
    .topbar a:hover { color: #fff; }
    .topbar .breadcrumb { color: #666; }
    .split { display: flex; flex: 1; overflow: hidden; }
    .sidebar {
      width: 320px;
      min-width: 320px;
      border-right: 1px solid #e0e0e0;
      background: #fff;
      display: flex;
      flex-direction: column;
    }
    .sidebar-top {
      padding: 12px;
      border-bottom: 1px solid #e0e0e0;
    }
    .sidebar-top .inbox-label {
      font-size: 12px; color: #888; margin-bottom: 8px;
    }
    .compose-btn {
      width: 100%;
      padding: 8px 12px;
      background: #111;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      margin-bottom: 10px;
    }
    .compose-btn:hover { background: #333; }
    .tabs {
      display: flex;
      gap: 4px;
    }
    .tab {
      padding: 5px 12px;
      font-size: 12px;
      border: 1px solid #ddd;
      border-radius: 14px;
      cursor: pointer;
      background: #fff;
      color: #555;
      white-space: nowrap;
    }
    .tab:hover { background: #f5f5f5; }
    .tab.active { background: #111; color: #fff; border-color: #111; }
    .tab .count { font-size: 11px; color: #999; margin-left: 4px; }
    .tab.active .count { color: #aaa; }
    .email-list { flex: 1; overflow-y: auto; }
    .email-item {
      padding: 12px 16px;
      border-bottom: 1px solid #f0f0f0;
      cursor: pointer;
      font-size: 14px;
    }
    .email-item:hover { background: #f5f5f5; }
    .email-item.active { background: #e8e8e8; }
    .email-item .email-subject {
      font-weight: 600; margin-bottom: 2px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .email-item .email-meta {
      font-size: 12px; color: #888;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .email-item .email-date { font-size: 11px; color: #999; margin-top: 2px; }
    .email-item .direction-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      padding: 1px 6px;
      border-radius: 3px;
      margin-right: 4px;
    }
    .direction-badge.received { background: #cce5ff; color: #004085; }
    .direction-badge.sent { background: #d4edda; color: #155724; }
    .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .email-header {
      padding: 20px 24px;
      border-bottom: 1px solid #e0e0e0;
      background: #fff;
      flex-shrink: 0;
    }
    .email-header h2 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
    .email-header .email-header-meta { font-size: 13px; color: #666; line-height: 1.6; }
    .email-header .email-header-meta strong { color: #333; }
    .main-content { flex: 1; overflow-y: auto; padding: 24px; }
    .rendered-md { line-height: 1.7; font-size: 15px; }
    .rendered-md h1 { font-size: 28px; margin: 20px 0 12px; }
    .rendered-md h2 { font-size: 22px; margin: 18px 0 10px; }
    .rendered-md h3 { font-size: 18px; margin: 16px 0 8px; }
    .rendered-md p { margin-bottom: 12px; }
    .rendered-md ul, .rendered-md ol { margin: 0 0 12px 24px; }
    .rendered-md code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
    .rendered-md pre { background: #f0f0f0; padding: 16px; border-radius: 6px; overflow-x: auto; margin-bottom: 12px; }
    .rendered-md pre code { background: none; padding: 0; }
    .rendered-md blockquote { border-left: 3px solid #ddd; padding-left: 16px; color: #666; margin-bottom: 12px; }
    .rendered-md table { border-collapse: collapse; width: 100%; margin-bottom: 12px; font-size: 14px; }
    .rendered-md th, .rendered-md td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    .rendered-md th { background: #f5f5f5; font-weight: 600; }
    .rendered-md tr:nth-child(even) { background: #fafafa; }
    .empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: #999; font-size: 16px; }
    .compose-form {
      padding: 24px;
      max-width: 640px;
    }
    .compose-form label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .compose-form input, .compose-form textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 14px;
      font-family: inherit;
      margin-bottom: 16px;
    }
    .compose-form input:focus, .compose-form textarea:focus {
      outline: none;
      border-color: #111;
    }
    .compose-form textarea { min-height: 200px; resize: vertical; }
    .compose-form .from-display {
      padding: 10px 12px;
      background: #f5f5f5;
      border-radius: 6px;
      font-size: 14px;
      color: #555;
      margin-bottom: 16px;
    }
    .compose-actions { display: flex; gap: 8px; }
    .compose-actions button {
      padding: 10px 24px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid #ddd;
      background: #fff;
      color: #555;
    }
    .compose-actions .btn-send {
      background: #111;
      color: #fff;
      border-color: #111;
    }
    .compose-actions .btn-send:hover { background: #333; }
    .compose-actions .btn-send:disabled { opacity: 0.5; cursor: not-allowed; }
    .compose-actions button:not(.btn-send):hover { background: #f5f5f5; }
    .send-status {
      margin-top: 12px;
      font-size: 13px;
      padding: 8px 12px;
      border-radius: 6px;
    }
    .send-status.success { background: #d4edda; color: #155724; }
    .send-status.error { background: #f8d7da; color: #721c24; }

    @media (prefers-color-scheme: dark) {
      body { background: #121212; color: #e0e0e0; }
      .topbar { background: #0d0d0d; }
      .sidebar { background: #1e1e1e; border-right-color: #333; }
      .sidebar-top { border-bottom-color: #333; }
      .sidebar-top .inbox-label { color: #888; }
      .compose-btn { background: #333; }
      .compose-btn:hover { background: #555; }
      .tabs { }
      .tab { background: #1e1e1e; color: #999; border-color: #444; }
      .tab:hover { background: #2a2a2a; }
      .tab.active { background: #e0e0e0; color: #111; border-color: #e0e0e0; }
      .tab .count { color: #777; }
      .tab.active .count { color: #555; }
      .email-item { border-bottom-color: #2a2a2a; color: #e0e0e0; }
      .email-item:hover { background: #2a2a2a; }
      .email-item.active { background: #333; }
      .email-item .email-meta { color: #888; }
      .email-item .email-date { color: #777; }
      .email-header { background: #1e1e1e; border-bottom-color: #333; }
      .email-header h2 { color: #e0e0e0; }
      .email-header .email-header-meta { color: #999; }
      .email-header .email-header-meta strong { color: #ccc; }
      .rendered-md { color: #ccc; }
      .rendered-md code { background: #2a2a2a; color: #e0e0e0; }
      .rendered-md pre { background: #2a2a2a; }
      .rendered-md blockquote { border-left-color: #555; color: #999; }
      .rendered-md th { background: #2a2a2a; color: #e0e0e0; }
      .rendered-md th, .rendered-md td { border-color: #444; }
      .rendered-md tr:nth-child(even) { background: #222; }
      .compose-form label { color: #999; }
      .compose-form input, .compose-form textarea { background: #2a2a2a; color: #e0e0e0; border-color: #555; }
      .compose-form input:focus, .compose-form textarea:focus { border-color: #e0e0e0; }
      .compose-form .from-display { background: #2a2a2a; color: #999; }
      .compose-actions button { background: #1e1e1e; color: #999; border-color: #555; }
      .compose-actions button:not(.btn-send):hover { background: #2a2a2a; }
      .compose-actions .btn-send { background: #333; color: #fff; border-color: #333; }
      .compose-actions .btn-send:hover { background: #555; }
      .send-status.success { background: #1a2a1a; color: #5cb85c; }
      .send-status.error { background: #2a1515; color: #e74c3c; }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="topbar-left">
      <h1>Open Polsia</h1>
      <span class="breadcrumb">/ <a href="/dashboard/${cId}">${cName}</a> / Emails</span>
    </div>
    <a href="/dashboard/${cId}">← Back to dashboard</a>
  </div>

  <div class="split">
    <div class="sidebar">
      <div class="sidebar-top">
        <div class="inbox-label">${cSlug}@openpolsia.com</div>
        <button class="compose-btn" onclick="showCompose()">+ Compose</button>
        <div class="tabs" id="tabs">
          <button class="tab active" data-filter="all" onclick="filterBy('all')">All <span class="count" id="count-all"></span></button>
          <button class="tab" data-filter="received" onclick="filterBy('received')">Inbox <span class="count" id="count-received"></span></button>
          <button class="tab" data-filter="sent" onclick="filterBy('sent')">Sent <span class="count" id="count-sent"></span></button>
        </div>
      </div>
      <div class="email-list" id="email-list"></div>
    </div>
    <div class="main">
      <div class="email-header" id="email-header" style="display:none">
        <h2 id="email-subject"></h2>
        <div class="email-header-meta" id="email-meta"></div>
      </div>
      <div class="main-content" id="main-content">
        <div class="empty-state">Select an email or compose a new one</div>
      </div>
    </div>
  </div>

  <script>
    var COMPANY_ID = '${cId}';
    var COMPANY_SLUG = '${cSlug}';
    var FROM_ADDR = COMPANY_SLUG + '@openpolsia.com';
    var allEmails = [];
    var filteredEmails = [];
    var selectedEmail = null;
    var currentFilter = 'all';
    var composing = false;

    function apiUrl(path) {
      return '/api/company/' + COMPANY_ID + path;
    }

    function isOutbound(e) {
      return e.from_addr.toLowerCase().endsWith('@openpolsia.com');
    }

    function loadEmails(initial) {
      fetch(apiUrl('/emails'), { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          allEmails = data.emails;
          updateCounts();
          applyFilter();
          if (initial && window.location.hash) {
            var hashId = window.location.hash.slice(1);
            var fromHash = allEmails.find(function(e) { return e.id === hashId; });
            if (fromHash) { selectEmail(fromHash); return; }
          }
          if (selectedEmail && !composing) {
            var still = allEmails.find(function(e) { return e.id === selectedEmail.id; });
            if (still) selectEmail(still);
            else { selectedEmail = null; renderMain(); }
          }
        });
    }

    function updateCounts() {
      var sent = 0, received = 0;
      allEmails.forEach(function(e) {
        if (isOutbound(e)) sent++;
        else received++;
      });
      document.getElementById('count-all').textContent = allEmails.length || '';
      document.getElementById('count-received').textContent = received || '';
      document.getElementById('count-sent').textContent = sent || '';
    }

    function filterBy(filter) {
      currentFilter = filter;
      composing = false;
      var tabs = document.querySelectorAll('.tab');
      tabs.forEach(function(t) {
        t.classList.toggle('active', t.getAttribute('data-filter') === filter);
      });
      applyFilter();
    }

    function applyFilter() {
      if (currentFilter === 'all') {
        filteredEmails = allEmails;
      } else if (currentFilter === 'sent') {
        filteredEmails = allEmails.filter(function(e) { return isOutbound(e); });
      } else {
        filteredEmails = allEmails.filter(function(e) { return !isOutbound(e); });
      }
      renderList();
    }

    function renderList() {
      var list = document.getElementById('email-list');
      if (filteredEmails.length === 0) {
        list.innerHTML = '<div style="padding:16px;color:#999;font-size:14px">No emails</div>';
        return;
      }
      list.innerHTML = filteredEmails.map(function(e) {
        var active = selectedEmail && selectedEmail.id === e.id && !composing ? ' active' : '';
        var dir = isOutbound(e);
        var badge = dir
          ? '<span class="direction-badge sent">Sent</span>'
          : '<span class="direction-badge received">Received</span>';
        var meta = dir ? 'To: ' + esc(e.to_addr) : 'From: ' + esc(e.from_addr);
        return '<div class="email-item' + active + '" onclick="selectEmailById(\\'' + e.id + '\\')">'
          + '<div class="email-subject">' + badge + esc(e.subject) + '</div>'
          + '<div class="email-meta">' + meta + '</div>'
          + '<div class="email-date">' + new Date(e.created_at).toLocaleDateString() + '</div>'
          + '</div>';
      }).join('');
    }

    function selectEmailById(id) {
      var email = allEmails.find(function(e) { return e.id === id; });
      if (email) selectEmail(email);
    }

    function selectEmail(email) {
      composing = false;
      selectedEmail = email;
      renderList();
      renderMain();
    }

    function showCompose() {
      composing = true;
      selectedEmail = null;
      renderList();

      var header = document.getElementById('email-header');
      header.style.display = 'none';
      var content = document.getElementById('main-content');
      content.innerHTML =
        '<div class="compose-form">' +
          '<label>From</label>' +
          '<div class="from-display">' + esc(FROM_ADDR) + '</div>' +
          '<label>To</label>' +
          '<input type="email" id="compose-to" placeholder="recipient@example.com" />' +
          '<label>Subject</label>' +
          '<input type="text" id="compose-subject" placeholder="Subject" />' +
          '<label>Body</label>' +
          '<textarea id="compose-body" placeholder="Write your email..."></textarea>' +
          '<div class="compose-actions">' +
            '<button class="btn-send" id="send-btn" onclick="sendEmail()">Send</button>' +
            '<button onclick="cancelCompose()">Cancel</button>' +
          '</div>' +
          '<div id="send-status"></div>' +
        '</div>';
      document.getElementById('compose-to').focus();
    }

    function cancelCompose() {
      composing = false;
      selectedEmail = null;
      renderList();
      renderMain();
    }

    function sendEmail() {
      var to = document.getElementById('compose-to').value.trim();
      var subject = document.getElementById('compose-subject').value.trim();
      var body = document.getElementById('compose-body').value.trim();
      var status = document.getElementById('send-status');
      var btn = document.getElementById('send-btn');

      if (!to || !subject || !body) {
        status.className = 'send-status error';
        status.textContent = 'Please fill in all fields.';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Sending...';
      status.textContent = '';

      fetch(apiUrl('/emails/send'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to, subject: subject, body: body })
      })
      .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
      .then(function(res) {
        if (res.ok && res.data.ok) {
          status.className = 'send-status success';
          status.textContent = 'Email sent successfully!';
          btn.textContent = 'Sent';
          setTimeout(function() {
            composing = false;
            loadEmails(false);
            filterBy('sent');
          }, 1000);
        } else {
          status.className = 'send-status error';
          status.textContent = 'Failed to send: ' + (res.data.error || 'Unknown error');
          btn.disabled = false;
          btn.textContent = 'Send';
        }
      })
      .catch(function(err) {
        status.className = 'send-status error';
        status.textContent = 'Network error: ' + err.message;
        btn.disabled = false;
        btn.textContent = 'Send';
      });
    }

    function renderMain() {
      var header = document.getElementById('email-header');
      var content = document.getElementById('main-content');

      if (composing) return;

      if (!selectedEmail) {
        header.style.display = 'none';
        content.innerHTML = '<div class="empty-state">Select an email or compose a new one</div>';
        return;
      }

      header.style.display = 'block';
      document.getElementById('email-subject').textContent = selectedEmail.subject;
      document.getElementById('email-meta').innerHTML =
        '<strong>From:</strong> ' + esc(selectedEmail.from_addr) + '<br/>' +
        '<strong>To:</strong> ' + esc(selectedEmail.to_addr) + '<br/>' +
        '<strong>Date:</strong> ' + new Date(selectedEmail.created_at).toLocaleString();

      content.innerHTML = '<div class="rendered-md">' + renderMarkdown(selectedEmail.body) + '</div>';
    }

    function esc(s) {
      var d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function renderMarkdown(text) {
      var html = esc(text);
      html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
      html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
      html = html.replace(/(<li>.*<\\/li>)/gs, '<ul>$1</ul>');
      // Tables
      html = html.replace(/((?:^\\|.+\\|\\s*$\\n?)+)/gm, function(table) {
        var rows = table.trim().split('\\n').filter(function(r) { return r.trim(); });
        if (rows.length < 2) return table;
        var isSep = function(r) { return /^\\|[\\s:-]+\\|$/.test(r.replace(/[\\s:-]/g, function(c) { return c === '|' ? '|' : ''; }).replace(/[^|]/g, '')); };
        // Check if row 2 is the separator
        var sepIdx = -1;
        for (var i = 0; i < rows.length; i++) {
          if (/^\\|[\\s:|-]+\\|$/.test(rows[i]) && /---/.test(rows[i])) { sepIdx = i; break; }
        }
        if (sepIdx < 1) return table;
        var parseRow = function(r) {
          return r.replace(/^\\|/, '').replace(/\\|$/, '').split('|').map(function(c) { return c.trim(); });
        };
        var thead = '<thead><tr>' + parseRow(rows[sepIdx - 1]).map(function(c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead>';
        var bodyRows = rows.slice(sepIdx + 1);
        var tbody = bodyRows.length > 0 ? '<tbody>' + bodyRows.map(function(r) {
          return '<tr>' + parseRow(r).map(function(c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody>' : '';
        return '<table>' + thead + tbody + '</table>';
      });
      html = html.replace(/^(?!<[hupblt])(\\S.+)$/gm, '<p>$1</p>');
      return html;
    }

    loadEmails(true);
  </script>
</body>
</html>`;
}
