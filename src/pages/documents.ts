import { Company, escapeHtml } from "../types";

export function documentsPageHTML(company: Company) {
  const cId = escapeHtml(company.id);
  const cName = escapeHtml(company.name);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Documents — ${cName} — Open Polsia</title>
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
    .topbar-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .topbar h1 {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 20px;
      font-weight: 700;
    }
    .topbar a {
      color: #aaa;
      text-decoration: underline;
      text-underline-offset: 2px;
      font-size: 14px;
    }
    .topbar a:hover { color: #fff; }
    .topbar .breadcrumb { color: #666; }
    .split {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .sidebar {
      width: 280px;
      min-width: 280px;
      border-right: 1px solid #e0e0e0;
      background: #fff;
      display: flex;
      flex-direction: column;
    }
    .sidebar-header {
      padding: 16px;
      border-bottom: 1px solid #e0e0e0;
      font-weight: 600;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
    }
    .doc-list {
      flex: 1;
      overflow-y: auto;
    }
    .doc-item {
      padding: 12px 16px;
      border-bottom: 1px solid #f0f0f0;
      cursor: pointer;
      font-size: 14px;
    }
    .doc-item:hover { background: #f5f5f5; }
    .doc-item.active { background: #e8e8e8; font-weight: 600; }
    .doc-item .doc-date {
      font-size: 11px;
      color: #999;
      margin-top: 2px;
    }
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .main-toolbar {
      padding: 12px 24px;
      border-bottom: 1px solid #e0e0e0;
      background: #fff;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    .main-toolbar h2 {
      font-size: 18px;
      font-weight: 600;
    }
    .main-toolbar .btn-group {
      display: flex;
      gap: 8px;
    }
    .btn {
      padding: 6px 16px;
      font-size: 13px;
      border: 1px solid #ccc;
      border-radius: 4px;
      cursor: pointer;
      background: #fff;
      color: #111;
    }
    .btn:hover { background: #f0f0f0; }
    .btn-primary {
      background: #111;
      color: #fff;
      border-color: #111;
    }
    .btn-primary:hover { background: #333; }
    .btn-danger {
      color: #c0392b;
      border-color: #e0b4b4;
    }
    .btn-danger:hover { background: #fdf0f0; }
    .main-content {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
    }
    .rendered-md {
      line-height: 1.7;
      font-size: 15px;
    }
    .rendered-md h1 { font-size: 28px; margin: 20px 0 12px; }
    .rendered-md h2 { font-size: 22px; margin: 18px 0 10px; }
    .rendered-md h3 { font-size: 18px; margin: 16px 0 8px; }
    .rendered-md p { margin-bottom: 12px; }
    .rendered-md ul, .rendered-md ol { margin: 0 0 12px 24px; }
    .rendered-md code {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 13px;
    }
    .rendered-md pre {
      background: #f0f0f0;
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
      margin-bottom: 12px;
    }
    .rendered-md pre code { background: none; padding: 0; }
    .rendered-md blockquote {
      border-left: 3px solid #ddd;
      padding-left: 16px;
      color: #666;
      margin-bottom: 12px;
    }
    .rendered-md table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 12px;
      font-size: 14px;
    }
    .rendered-md th, .rendered-md td {
      border: 1px solid #ddd;
      padding: 8px 12px;
      text-align: left;
    }
    .rendered-md th {
      background: #f5f5f5;
      font-weight: 600;
    }
    .rendered-md tr:nth-child(even) {
      background: #fafafa;
    }
    .edit-area {
      width: 100%;
      height: 100%;
      min-height: 300px;
      padding: 16px;
      font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
      font-size: 14px;
      line-height: 1.6;
      border: 1px solid #ddd;
      border-radius: 6px;
      resize: none;
      outline: none;
    }
    .edit-area:focus { border-color: #111; }
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #999;
      font-size: 16px;
    }

    @media (prefers-color-scheme: dark) {
      body { background: #121212; color: #e0e0e0; }
      .topbar { background: #0d0d0d; }
      .sidebar { background: #1e1e1e; border-right-color: #333; }
      .sidebar-header { color: #888; border-bottom-color: #333; }
      .doc-item { border-bottom-color: #2a2a2a; color: #e0e0e0; }
      .doc-item:hover { background: #2a2a2a; }
      .doc-item.active { background: #333; }
      .doc-item .doc-date { color: #777; }
      .main-toolbar { background: #1e1e1e; border-bottom-color: #333; }
      .main-toolbar h2 { color: #e0e0e0; }
      .btn { background: #1e1e1e; color: #e0e0e0; border-color: #555; }
      .btn:hover { background: #2a2a2a; }
      .btn-primary { background: #333; color: #fff; border-color: #333; }
      .btn-primary:hover { background: #555; }
      .btn-danger { color: #e74c3c; border-color: #5a2020; }
      .btn-danger:hover { background: #2a1515; }
      .rendered-md { color: #ccc; }
      .rendered-md code { background: #2a2a2a; color: #e0e0e0; }
      .rendered-md pre { background: #2a2a2a; }
      .rendered-md blockquote { border-left-color: #555; color: #999; }
      .rendered-md th { background: #2a2a2a; color: #e0e0e0; }
      .rendered-md th, .rendered-md td { border-color: #444; }
      .rendered-md tr:nth-child(even) { background: #222; }
      .edit-area { background: #1e1e1e; color: #e0e0e0; border-color: #555; }
      .edit-area:focus { border-color: #e0e0e0; }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="topbar-left">
      <h1>Open Polsia</h1>
      <span class="breadcrumb">/ <a href="/dashboard/${cId}">${cName}</a> / Documents</span>
    </div>
    <a href="/dashboard/${cId}">← Back to dashboard</a>
  </div>

  <div class="split">
    <div class="sidebar">
      <div class="sidebar-header">Documents</div>
      <div class="doc-list" id="doc-list"></div>
    </div>
    <div class="main">
      <div class="main-toolbar" id="toolbar" style="display:none">
        <h2 id="doc-title"></h2>
        <div class="btn-group">
          <button class="btn" id="btn-edit" onclick="startEdit()">Edit</button>
          <button class="btn btn-primary" id="btn-save" onclick="saveDoc()" style="display:none">Save</button>
          <button class="btn" id="btn-cancel" onclick="cancelEdit()" style="display:none">Cancel</button>
          <button class="btn btn-danger" id="btn-delete" onclick="deleteDoc()">Delete</button>
        </div>
      </div>
      <div class="main-content" id="main-content">
        <div class="empty-state">Select a document</div>
      </div>
    </div>
  </div>

  <script>
    var COMPANY_ID = '${cId}';
    var documents = [];
    var selectedDoc = null;
    var editing = false;

    function apiUrl(path) {
      return '/api/company/' + COMPANY_ID + path;
    }

    function loadDocuments(initial) {
      fetch(apiUrl('/documents'), { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          documents = data.documents;
          renderList();
          if (initial && window.location.hash) {
            var hashId = window.location.hash.slice(1);
            var fromHash = documents.find(function(d) { return d.id === hashId; });
            if (fromHash) { selectDoc(fromHash); return; }
          }
          if (selectedDoc) {
            var still = documents.find(function(d) { return d.id === selectedDoc.id; });
            if (still) selectDoc(still);
            else { selectedDoc = null; renderMain(); }
          }
        });
    }

    function renderList() {
      var list = document.getElementById('doc-list');
      if (documents.length === 0) {
        list.innerHTML = '<div style="padding:16px;color:#999;font-size:14px">No documents yet</div>';
        return;
      }
      list.innerHTML = documents.map(function(d) {
        var active = selectedDoc && selectedDoc.id === d.id ? ' active' : '';
        return '<div class="doc-item' + active + '" onclick="selectDocById(\\'' + d.id + '\\')">'
          + '<div>' + esc(d.title) + '</div>'
          + '<div class="doc-date">' + new Date(d.created_at).toLocaleDateString() + '</div>'
          + '</div>';
      }).join('');
    }

    function selectDocById(id) {
      var doc = documents.find(function(d) { return d.id === id; });
      if (doc) selectDoc(doc);
    }

    function selectDoc(doc) {
      selectedDoc = doc;
      editing = false;
      renderList();
      renderMain();
    }

    function renderMain() {
      var toolbar = document.getElementById('toolbar');
      var content = document.getElementById('main-content');
      var btnEdit = document.getElementById('btn-edit');
      var btnSave = document.getElementById('btn-save');
      var btnCancel = document.getElementById('btn-cancel');

      if (!selectedDoc) {
        toolbar.style.display = 'none';
        content.innerHTML = '<div class="empty-state">Select a document</div>';
        return;
      }

      toolbar.style.display = 'flex';
      document.getElementById('doc-title').textContent = selectedDoc.title;

      if (editing) {
        btnEdit.style.display = 'none';
        btnSave.style.display = '';
        btnCancel.style.display = '';
        content.innerHTML = '<textarea class="edit-area" id="edit-content">' + esc(selectedDoc.content) + '</textarea>';
        document.getElementById('edit-content').focus();
      } else {
        btnEdit.style.display = '';
        btnSave.style.display = 'none';
        btnCancel.style.display = 'none';
        content.innerHTML = '<div class="rendered-md">' + renderMarkdown(selectedDoc.content) + '</div>';
      }
    }

    function startEdit() {
      editing = true;
      renderMain();
    }

    function cancelEdit() {
      editing = false;
      renderMain();
    }

    function saveDoc() {
      var content = document.getElementById('edit-content').value;
      fetch(apiUrl('/documents/' + selectedDoc.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: selectedDoc.title, content: content }),
      })
        .then(function(r) { return r.json(); })
        .then(function(updated) {
          selectedDoc = updated;
          editing = false;
          loadDocuments();
        });
    }

    function deleteDoc() {
      if (!confirm('Delete "' + selectedDoc.title + '"?')) return;
      fetch(apiUrl('/documents/' + selectedDoc.id), {
        method: 'DELETE',
        credentials: 'include',
      })
        .then(function() {
          selectedDoc = null;
          editing = false;
          loadDocuments();
          renderMain();
        });
    }

    function esc(s) {
      var d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function renderMarkdown(text) {
      // Simple markdown renderer
      var html = esc(text);
      // Code blocks
      html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
      // Inline code
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      // Headers
      html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
      // Bold / italic
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      // Blockquotes
      html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
      // Unordered lists
      html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
      html = html.replace(/(<li>.*<\\/li>)/gs, '<ul>$1</ul>');
      // Tables
      html = html.replace(/((?:^\\|.+\\|\\s*$\\n?)+)/gm, function(table) {
        var rows = table.trim().split('\\n').filter(function(r) { return r.trim(); });
        if (rows.length < 2) return table;
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
      // Paragraphs (lines not already wrapped)
      html = html.replace(/^(?!<[hupblt])(\\S.+)$/gm, '<p>$1</p>');
      return html;
    }

    loadDocuments(true);
  </script>
</body>
</html>`;
}
