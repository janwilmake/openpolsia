import { Company, escapeHtml } from "../types";

function dataCard(
  title: string,
  items: any[],
  renderItem: (item: any) => string,
  showAllHref?: string | null
): string {
  const showAllLink = showAllHref
    ? `<a href="${showAllHref}" class="show-all">show all →</a>`
    : "";
  if (!items || items.length === 0) {
    return `<div class="card"><h3>${title}</h3><div class="card-item" style="color:#aaa">No ${title.toLowerCase()} yet</div></div>`;
  }
  return `<div class="card"><h3>${title} ${showAllLink}</h3>${items.map((item) => `<div class="card-item">${renderItem(item)}</div>`).join("")}</div>`;
}

export function dashboardHTML(
  userName: string,
  companies: Company[],
  selectedCompany: Company | null,
  companyData: any
) {
  const eName = escapeHtml(userName);

  const companySwitcher =
    companies.length > 0
      ? `<select id="company-select" onchange="switchCompany(this.value)">
        ${companies.map((c) => `<option value="${escapeHtml(c.id)}" ${selectedCompany && c.id === selectedCompany.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
      </select>
      <a href="/new" class="topbar-add" title="New company">+</a>
      <a onclick="deleteCompany()" class="topbar-delete" title="Delete company">&times;</a>`
      : "";

  const cIdSafe = selectedCompany ? escapeHtml(selectedCompany.id) : "";

  const companySection =
    selectedCompany && companyData
      ? `
      <div class="dashboard-layout">
        <div class="dashboard-main">
          <div class="company-name">${escapeHtml(selectedCompany.name)}</div>
          <div class="data-grid">
            ${dataCard("Documents", companyData.documents.slice(0, 3), (d: any) => `<a href="/dashboard/${cIdSafe}/documents#${escapeHtml(d.id)}" class="doc-link"><strong>${escapeHtml(d.title)}</strong><br/><span class="doc-preview">${escapeHtml(d.content)}</span></a>`, `/dashboard/${cIdSafe}/documents`)}
            <div class="card"><h3>Links</h3><div class="card-item"><a href="https://${escapeHtml(selectedCompany.slug)}.openpolsia.com" target="_blank" class="doc-link">${escapeHtml(selectedCompany.slug)}.openpolsia.com</a></div></div>
            ${dataCard("Tasks", companyData.tasks.slice(0, 3), (t: any) => { const ds = t.recurrence ? "recurring" : t.status; return `<a href="/dashboard/${cIdSafe}/tasks#${escapeHtml(t.id)}" class="doc-link"><span class="badge badge-${ds}">${escapeHtml(ds)}</span> ${escapeHtml(t.title)}</a>`; }, `/dashboard/${cIdSafe}/tasks`)}
            ${dataCard(`Emails <small style="font-weight:normal;color:#888;font-size:12px">${escapeHtml(selectedCompany.slug)}@openpolsia.com</small>`, companyData.emails.slice(0, 3), (e: any) => `<a href="/dashboard/${cIdSafe}/emails#${escapeHtml(e.id)}" class="doc-link"><strong>${escapeHtml(e.subject)}</strong><br/><small>${escapeHtml(e.from_addr)} → ${escapeHtml(e.to_addr)}</small></a>`, `/dashboard/${cIdSafe}/emails`)}
            ${dataCard("Logs", companyData.logs.slice(0, 5), (l: any) => {
              const badge =
                l.type === "tool_call"
                  ? "badge-in_progress"
                  : "badge-completed";
              const label = l.type === "tool_call" ? "call" : "result";
              let detail = "";
              try {
                const parsed = JSON.parse(l.content);
                detail =
                  parsed.tool +
                  (parsed.input
                    ? ": " + JSON.stringify(parsed.input).slice(0, 80)
                    : "");
              } catch {
                detail = l.content;
              }
              return `<span class="badge ${badge}">${escapeHtml(label)}</span> ${escapeHtml(detail)}`;
            })}
          </div>
        </div>
        <div class="chat-panel" id="chat-panel">
          <div class="chat-header">Chat</div>
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-input-area">
            <input type="text" id="chat-input" placeholder="Type a message..." onkeydown="if(event.key==='Enter')sendMessage()" />
            <button class="chat-send" onclick="sendMessage()">Send</button>
          </div>
        </div>
      </div>`
      : `<p class="empty">No companies yet. <a href="/new">Create your first company</a></p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dashboard — Open Polsia</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      color: #111;
      background: #f8f8f8;
    }
    .topbar {
      background: #111;
      color: #fff;
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 14px;
    }
    .topbar-left {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .topbar h1 {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 20px;
      font-weight: 700;
    }
    .topbar select {
      background: #333;
      color: #fff;
      border: 1px solid #555;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 13px;
    }
    .topbar-add {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      background: #333;
      color: #fff;
      border: 1px solid #555;
      border-radius: 4px;
      font-size: 18px;
      text-decoration: none;
      line-height: 1;
    }
    .topbar-add:hover { background: #555; }
    .topbar-delete {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      background: #333;
      color: #f55;
      border: 1px solid #555;
      border-radius: 4px;
      font-size: 18px;
      text-decoration: none;
      line-height: 1;
      cursor: pointer;
    }
    .topbar-delete:hover { background: #500; color: #fff; }
    .topbar-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .topbar-right span { color: #aaa; }
    .topbar-right a {
      color: #aaa;
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
    }
    .topbar-right a:hover { color: #fff; }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 32px 24px;
    }
    .dashboard-layout {
      display: flex;
      gap: 24px;
      align-items: flex-start;
    }
    .dashboard-main {
      flex: 1;
      min-width: 0;
    }
    .company-name {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 24px;
    }
    .data-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 900px) {
      .dashboard-layout { flex-direction: column; }
      .chat-panel { width: 100% !important; max-height: 400px; }
      .data-grid { grid-template-columns: 1fr; }
    }
    .chat-panel {
      width: 340px;
      min-width: 340px;
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      height: 520px;
      position: sticky;
      top: 24px;
    }
    .chat-header {
      padding: 14px 16px;
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
      border-bottom: 1px solid #e0e0e0;
      flex-shrink: 0;
    }
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
    }
    .chat-msg {
      margin-bottom: 12px;
      font-size: 14px;
      line-height: 1.5;
    }
    .chat-msg .chat-role {
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .chat-msg.chat-user .chat-role { color: #2980b9; }
    .chat-msg.chat-agent .chat-role { color: #888; }
    .chat-msg .chat-text {
      color: #222;
    }
    .chat-msg .chat-text.rendered-md { font-size: 13px; line-height: 1.5; }
    .chat-msg .chat-text.rendered-md p { margin-bottom: 6px; }
    .chat-msg .chat-text.rendered-md pre { padding: 8px; font-size: 12px; }
    .chat-msg .chat-text.rendered-md h1, .chat-msg .chat-text.rendered-md h2, .chat-msg .chat-text.rendered-md h3 { margin: 8px 0 4px; }
    .chat-msg .chat-text.rendered-md ul { margin: 0 0 6px 16px; }
    .chat-input-area {
      display: flex;
      border-top: 1px solid #e0e0e0;
      flex-shrink: 0;
    }
    .chat-input-area input {
      flex: 1;
      border: none;
      padding: 12px 16px;
      font-size: 14px;
      outline: none;
      font-family: inherit;
    }
    .chat-send {
      padding: 12px 20px;
      background: #111;
      color: #fff;
      border: none;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
    }
    .chat-send:hover { background: #333; }
    .chat-send:disabled { opacity: 0.5; cursor: not-allowed; }
    .chat-streaming::after {
      content: '\\25CF';
      animation: blink 1s infinite;
      margin-left: 2px;
    }
    @keyframes blink { 50% { opacity: 0; } }
    .card {
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 20px;
      min-width: 0;
      overflow: hidden;
      word-break: break-word;
    }
    .card h3 {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
      margin-bottom: 14px;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    .show-all {
      font-size: 12px;
      text-transform: none;
      letter-spacing: 0;
      color: #666;
      text-decoration: underline;
    }
    .card-item {
      font-size: 14px;
      line-height: 1.6;
      padding: 8px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .card-item:last-child { border-bottom: none; }
    .doc-link {
      color: inherit;
      text-decoration: none;
      display: block;
    }
    .doc-link:hover { color: #444; }
    .doc-preview {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      font-size: 13px;
      color: #666;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-todo { background: #e2e3e5; color: #383d41; }
    .badge-in_progress { background: #cce5ff; color: #004085; }
    .badge-completed { background: #d4edda; color: #155724; }
    .badge-recurring { background: #e8daef; color: #6c3483; }
    .badge-rejected { background: #f5b7b1; color: #78281f; }
    .badge-failed { background: #f8d7da; color: #721c24; }
    .badge-info { background: #e2e3e5; color: #383d41; }
    .badge-warn { background: #fff3cd; color: #856404; }
    .badge-error { background: #f8d7da; color: #721c24; }
    .empty {
      font-size: 18px;
      color: #666;
      text-align: center;
      padding: 60px 0;
    }
    .empty a {
      color: #111;
      text-decoration: underline;
    }

    @media (prefers-color-scheme: dark) {
      body { background: #121212; color: #e0e0e0; }
      .topbar { background: #0d0d0d; }
      .topbar select { background: #222; border-color: #444; }
      .topbar-add { background: #222; border-color: #444; }
      .topbar-add:hover { background: #444; }
      .topbar-delete { background: #222; border-color: #444; }
      .topbar-delete:hover { background: #500; }
      .company-name { color: #e0e0e0; }
      .card { background: #1e1e1e; border-color: #333; }
      .card-item { border-bottom-color: #2a2a2a; }
      .doc-link { color: #e0e0e0; }
      .doc-link:hover { color: #bbb; }
      .doc-preview { color: #999; }
      .chat-panel { background: #1e1e1e; border-color: #333; }
      .chat-header { color: #888; border-bottom-color: #333; }
      .chat-msg .chat-text { color: #ccc; }
      .chat-input-area { border-top-color: #333; }
      .chat-input-area input { background: #1e1e1e; color: #e0e0e0; }
      .chat-send { background: #333; }
      .chat-send:hover { background: #555; }
      .empty { color: #999; }
      .empty a { color: #e0e0e0; }
      .show-all { color: #999; }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="topbar-left">
      <h1>Open Polsia</h1>
      ${companySwitcher}
    </div>
    <div class="topbar-right">
      <span>${eName}</span>
      <a onclick="signOut()">Sign out</a>
    </div>
  </div>

  <div class="container">
    ${companySection}
  </div>

  <script>
    var COMPANY_ID = '${cIdSafe}';

    function switchCompany(id) {
      window.location.href = '/dashboard/' + id;
    }
    function deleteCompany() {
      if (!COMPANY_ID) return;
      if (!confirm('Are you sure you want to delete this company? This cannot be undone.')) return;
      fetch('/api/companies/' + COMPANY_ID, {
        method: 'DELETE',
        credentials: 'include',
      }).then(function(r) {
        if (r.ok) window.location.href = '/dashboard';
      });
    }
    function signOut() {
      fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      }).then(function() { window.location.href = '/'; });
    }

    var streamingPollTimer = null;

    function loadChat() {
      if (!COMPANY_ID) return;
      fetch('/api/company/' + COMPANY_ID + '/chat', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          renderChat(data.messages);
          checkStreaming();
        });
    }

    function checkStreaming() {
      if (!COMPANY_ID) return;
      fetch('/api/company/' + COMPANY_ID + '/chat/streaming', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.message && data.message.content !== undefined) {
            showStreamingBubble(data.message.content);
            // Poll for updates
            if (streamingPollTimer) clearTimeout(streamingPollTimer);
            streamingPollTimer = setTimeout(checkStreaming, 500);
          } else {
            // Streaming done — reload chat to get final message
            removeStreamingBubble();
            if (streamingPollTimer) {
              clearTimeout(streamingPollTimer);
              streamingPollTimer = null;
              // Reload to pick up the finalized message
              fetch('/api/company/' + COMPANY_ID + '/chat', { credentials: 'include' })
                .then(function(r) { return r.json(); })
                .then(function(d) { renderChat(d.messages); });
            }
          }
        });
    }

    function showStreamingBubble(text) {
      var el = document.getElementById('chat-messages');
      if (!el) return;
      var bubble = document.getElementById('streaming-bubble');
      if (!bubble) {
        bubble = document.createElement('div');
        bubble.id = 'streaming-bubble';
        bubble.className = 'chat-msg chat-agent';
        el.appendChild(bubble);
      }
      var rendered = text ? renderMarkdown(text) : '';
      bubble.innerHTML = '<div class="chat-role">assistant</div>'
        + '<div class="chat-text rendered-md chat-streaming">' + rendered + '</div>';
      el.scrollTop = el.scrollHeight;
    }

    function removeStreamingBubble() {
      var bubble = document.getElementById('streaming-bubble');
      if (bubble) bubble.remove();
    }

    function renderChat(messages) {
      var el = document.getElementById('chat-messages');
      if (!el) return;
      if (!messages || messages.length === 0) {
        el.innerHTML = '<div style="color:#999;font-size:14px;padding:8px 0">No messages yet</div>';
        return;
      }
      el.innerHTML = messages.map(function(m) {
        var cls = m.role === 'user' ? 'chat-user' : 'chat-agent';
        var rendered = m.role === 'user' ? esc(m.content) : renderMarkdown(m.content);
        return '<div class="chat-msg ' + cls + '">'
          + '<div class="chat-role">' + esc(m.role) + '</div>'
          + '<div class="chat-text rendered-md">' + rendered + '</div>'
          + '</div>';
      }).join('');
      el.scrollTop = el.scrollHeight;
    }

    var isSending = false;

    function sendMessage() {
      var input = document.getElementById('chat-input');
      var text = input.value.trim();
      if (!text || !COMPANY_ID || isSending) return;
      input.value = '';
      isSending = true;

      // Stop any active streaming poll and remove its bubble
      if (streamingPollTimer) { clearTimeout(streamingPollTimer); streamingPollTimer = null; }
      removeStreamingBubble();

      var el = document.getElementById('chat-messages');

      // Add user message immediately
      var userDiv = document.createElement('div');
      userDiv.className = 'chat-msg chat-user';
      userDiv.innerHTML = '<div class="chat-role">user</div><div class="chat-text">' + esc(text) + '</div>';
      el.appendChild(userDiv);

      // Add assistant placeholder
      var assistantDiv = document.createElement('div');
      assistantDiv.className = 'chat-msg chat-agent';
      assistantDiv.innerHTML = '<div class="chat-role">assistant</div><div class="chat-text chat-streaming"></div>';
      el.appendChild(assistantDiv);
      var textEl = assistantDiv.querySelector('.chat-text');
      el.scrollTop = el.scrollHeight;

      fetch('/api/company/' + COMPANY_ID + '/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: text }),
      }).then(function(response) {
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var fullText = '';

        function read() {
          reader.read().then(function(result) {
            if (result.done) {
              isSending = false;
              textEl.classList.remove('chat-streaming');
              textEl.innerHTML = renderMarkdown(fullText);
              return;
            }
            fullText += decoder.decode(result.value, { stream: true });
            textEl.innerHTML = renderMarkdown(fullText);
            el.scrollTop = el.scrollHeight;
            read();
          });
        }
        read();
      }).catch(function(err) {
        isSending = false;
        textEl.classList.remove('chat-streaming');
        textEl.textContent = 'Error: ' + err.message;
      });
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

    function esc(s) {
      var d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    loadChat();
  </script>
</body>
</html>`;
}
