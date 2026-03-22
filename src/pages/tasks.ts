import { Company, escapeHtml } from "../types";

export function tasksPageHTML(company: Company) {
  const cId = escapeHtml(company.id);
  const cName = escapeHtml(company.name);

  const categories = [
    { key: "all", label: "All" },
    { key: "todo", label: "To Do" },
    { key: "recurring", label: "↻ Recurring" },
    { key: "in_progress", label: "In Progress" },
    { key: "completed", label: "Completed" },
    { key: "rejected", label: "Rejected" },
    { key: "failed", label: "Failed" }
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tasks — ${cName} — Open Polsia</title>
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
      width: 300px;
      min-width: 300px;
      border-right: 1px solid #e0e0e0;
      background: #fff;
      display: flex;
      flex-direction: column;
    }
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 12px 12px 8px;
      border-bottom: 1px solid #e0e0e0;
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
    .tab .count {
      font-size: 11px;
      color: #999;
      margin-left: 4px;
    }
    .tab.active .count { color: #aaa; }
    .task-list {
      flex: 1;
      overflow-y: auto;
    }
    .task-item {
      padding: 12px 16px;
      border-bottom: 1px solid #f0f0f0;
      cursor: pointer;
      font-size: 14px;
    }
    .task-item:hover { background: #f5f5f5; }
    .task-item.active { background: #e8e8e8; }
    .task-item .task-title {
      margin-bottom: 4px;
    }
    .task-item .task-meta {
      font-size: 12px;
      color: #888;
      display: flex;
      gap: 8px;
      align-items: center;
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
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .task-header {
      padding: 20px 24px;
      border-bottom: 1px solid #e0e0e0;
      background: #fff;
      flex-shrink: 0;
    }
    .task-header h2 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .task-header .task-header-meta {
      font-size: 13px;
      color: #666;
      display: flex;
      gap: 16px;
      align-items: center;
    }
    .retry-btn {
      padding: 4px 14px;
      background: #111;
      color: #fff;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .retry-btn:hover { background: #333; }
    .main-content {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
    }
    .task-description {
      font-size: 15px;
      line-height: 1.7;
      color: #222;
    }
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #999;
      font-size: 16px;
    }
    .empty-list {
      padding: 16px;
      color: #999;
      font-size: 14px;
    }
    .task-messages {
      margin-top: 20px;
      border-top: 1px solid #e0e0e0;
      padding-top: 16px;
    }
    .task-messages h4 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
      margin-bottom: 12px;
    }
    .task-msg {
      padding: 8px 12px;
      margin-bottom: 6px;
      border-radius: 4px;
      font-size: 13px;
      line-height: 1.5;
    }
    .task-msg-call {
      background: #f0f4ff;
      border-left: 3px solid #4a90d9;
    }
    .task-msg-result {
      background: #f0faf0;
      border-left: 3px solid #5cb85c;
    }
    .task-msg-text {
      background: #fff;
      border: 1px solid #e0e0e0;
    }
    .task-msg .msg-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .task-msg-call .msg-label { color: #4a90d9; }
    .task-msg-result .msg-label { color: #5cb85c; }
    .task-msg-text .msg-label { color: #888; }
    .task-msg .msg-body {
      word-break: break-word;
      white-space: pre-wrap;
    }
    .task-msg .msg-tool {
      font-weight: 600;
    }
    .task-msg .msg-detail {
      color: #555;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      font-size: 12px;
      max-height: 120px;
      overflow-y: auto;
    }
    .task-messages-loading {
      color: #999;
      font-size: 13px;
      font-style: italic;
    }

    @media (prefers-color-scheme: dark) {
      body { background: #121212; color: #e0e0e0; }
      .topbar { background: #0d0d0d; }
      .sidebar { background: #1e1e1e; border-right-color: #333; }
      .tabs { border-bottom-color: #333; }
      .tab { background: #1e1e1e; color: #999; border-color: #444; }
      .tab:hover { background: #2a2a2a; }
      .tab.active { background: #e0e0e0; color: #111; border-color: #e0e0e0; }
      .tab .count { color: #777; }
      .tab.active .count { color: #555; }
      .task-item { border-bottom-color: #2a2a2a; color: #e0e0e0; }
      .task-item:hover { background: #2a2a2a; }
      .task-item.active { background: #333; }
      .task-item .task-meta { color: #888; }
      .task-header { background: #1e1e1e; border-bottom-color: #333; }
      .task-header h2 { color: #e0e0e0; }
      .task-header .task-header-meta { color: #999; }
      .retry-btn { background: #333; }
      .retry-btn:hover { background: #555; }
      .task-description { color: #ccc; }
      .task-messages { border-top-color: #333; }
      .task-msg-call { background: #1a2233; border-left-color: #4a90d9; }
      .task-msg-result { background: #1a2a1a; border-left-color: #5cb85c; }
      .task-msg-text { background: #1e1e1e; border-color: #333; }
      .task-msg .msg-detail { color: #aaa; }
      .empty-list { color: #777; }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="topbar-left">
      <h1>Open Polsia</h1>
      <span class="breadcrumb">/ <a href="/dashboard/${cId}">${cName}</a> / Tasks</span>
    </div>
    <a href="/dashboard/${cId}">← Back to dashboard</a>
  </div>

  <div class="split">
    <div class="sidebar">
      <div class="tabs" id="tabs">
        ${categories.map((c) => `<button class="tab${c.key === "all" ? " active" : ""}" data-cat="${c.key}" onclick="filterBy('${c.key}')">${c.label} <span class="count" id="count-${c.key}"></span></button>`).join("")}
      </div>
      <div class="task-list" id="task-list"></div>
    </div>
    <div class="main">
      <div class="task-header" id="task-header" style="display:none">
        <h2 id="task-title"></h2>
        <div class="task-header-meta" id="task-meta"></div>
      </div>
      <div class="main-content" id="main-content">
        <div class="empty-state">Select a task</div>
      </div>
    </div>
  </div>

  <script>
    var COMPANY_ID = '${cId}';
    var allTasks = [];
    var filteredTasks = [];
    var selectedTask = null;
    var currentFilter = 'all';

    function apiUrl(path) {
      return '/api/company/' + COMPANY_ID + path;
    }

    function displayStatus(t) {
      return t.recurrence ? 'recurring' : t.status;
    }

    function loadTasks(initial) {
      fetch(apiUrl('/tasks'), { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          allTasks = data.tasks;
          updateCounts();
          applyFilter();
          if (initial && window.location.hash) {
            var hashId = window.location.hash.slice(1);
            var fromHash = allTasks.find(function(t) { return t.id === hashId; });
            if (fromHash) {
              currentFilter = 'all';
              setActiveTab('all');
              applyFilter();
              selectTask(fromHash);
              return;
            }
          }
          if (selectedTask) {
            var still = allTasks.find(function(t) { return t.id === selectedTask.id; });
            if (still) selectTask(still);
            else { selectedTask = null; renderMain(); }
          }
        });
    }

    function updateCounts() {
      var cats = { all: allTasks.length, todo: 0, recurring: 0, in_progress: 0, completed: 0, rejected: 0, failed: 0 };
      allTasks.forEach(function(t) { var ds = displayStatus(t); if (cats[ds] !== undefined) cats[ds]++; });
      Object.keys(cats).forEach(function(k) {
        var el = document.getElementById('count-' + k);
        if (el) el.textContent = '(' + cats[k] + ')';
      });
    }

    function filterBy(cat) {
      currentFilter = cat;
      setActiveTab(cat);
      applyFilter();
    }

    function setActiveTab(cat) {
      var tabs = document.querySelectorAll('.tab');
      tabs.forEach(function(t) {
        t.classList.toggle('active', t.getAttribute('data-cat') === cat);
      });
    }

    function applyFilter() {
      if (currentFilter === 'all') {
        filteredTasks = allTasks;
      } else {
        filteredTasks = allTasks.filter(function(t) { return displayStatus(t) === currentFilter; });
      }
      renderList();
    }

    function renderList() {
      var list = document.getElementById('task-list');
      if (filteredTasks.length === 0) {
        list.innerHTML = '<div class="empty-list">No tasks in this category</div>';
        return;
      }
      list.innerHTML = filteredTasks.map(function(t) {
        var active = selectedTask && selectedTask.id === t.id ? ' active' : '';
        var ds = displayStatus(t);
        return '<div class="task-item' + active + '" onclick="selectTaskById(\\'' + t.id + '\\')">'
          + '<div class="task-title">' + esc(t.title) + '</div>'
          + '<div class="task-meta">'
          + '<span class="badge badge-' + ds + '">' + esc(ds) + '</span>'
          + (t.assigned_to ? '<span>' + esc(t.assigned_to) + '</span>' : '')
          + '</div>'
          + '</div>';
      }).join('');
    }

    function selectTaskById(id) {
      var task = allTasks.find(function(t) { return t.id === id; });
      if (task) selectTask(task);
    }

    function selectTask(task) {
      selectedTask = task;
      renderList();
      renderMain();
    }

    function renderMain() {
      var header = document.getElementById('task-header');
      var content = document.getElementById('main-content');

      if (!selectedTask) {
        header.style.display = 'none';
        content.innerHTML = '<div class="empty-state">Select a task</div>';
        return;
      }

      header.style.display = 'block';
      document.getElementById('task-title').textContent = selectedTask.title;
      document.getElementById('task-meta').innerHTML =
        '<span class="badge badge-' + displayStatus(selectedTask) + '">' + esc(displayStatus(selectedTask)) + '</span>'
        + (selectedTask.assigned_to ? '<span>Assigned to: <strong>' + esc(selectedTask.assigned_to) + '</strong></span>' : '')
        + (selectedTask.recurrence ? '<span>Recurs: <strong>' + esc(selectedTask.recurrence) + '</strong></span>' : '')
        + '<span>' + new Date(selectedTask.created_at).toLocaleString() + '</span>'
        + (selectedTask.status === 'failed' ? '<button class="retry-btn" onclick="retryTask(\\'' + selectedTask.id + '\\')">Retry</button>' : '');

      var desc = selectedTask.description
        ? '<div class="task-description">' + esc(selectedTask.description) + '</div>'
        : '';

      content.innerHTML = desc
        + '<div class="task-messages" id="task-messages">'
        + '<h4>Activity</h4>'
        + '<div class="task-messages-loading">Loading...</div>'
        + '</div>';

      loadTaskMessages(selectedTask.id);
    }

    function loadTaskMessages(taskId) {
      fetch(apiUrl('/tasks/' + taskId + '/messages'), { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var container = document.getElementById('task-messages');
          if (!container || !selectedTask || selectedTask.id !== taskId) return;

          if (!data.messages || data.messages.length === 0) {
            container.innerHTML = '<h4>Activity</h4><div style="color:#bbb;font-size:13px">No activity yet</div>';
            return;
          }

          var html = '<h4>Activity (' + data.messages.length + ')</h4>';
          data.messages.forEach(function(msg) {
            if (msg.type === 'tool_call') {
              var parsed = {};
              try { parsed = JSON.parse(msg.content); } catch(e) {}
              html += '<div class="task-msg task-msg-call">'
                + '<div class="msg-label">Tool Call</div>'
                + '<div class="msg-tool">' + esc(parsed.tool || 'unknown') + '</div>'
                + '<div class="msg-detail">' + esc(JSON.stringify(parsed.input || {}, null, 2)) + '</div>'
                + '</div>';
            } else if (msg.type === 'tool_result') {
              var parsed = {};
              try { parsed = JSON.parse(msg.content); } catch(e) {}
              html += '<div class="task-msg task-msg-result">'
                + '<div class="msg-label">Result — ' + esc(parsed.tool || '') + '</div>'
                + '<div class="msg-detail">' + esc(JSON.stringify(parsed.result || {}, null, 2)) + '</div>'
                + '</div>';
            } else {
              html += '<div class="task-msg task-msg-text">'
                + '<div class="msg-label">Assistant</div>'
                + '<div class="msg-body">' + esc(msg.content) + '</div>'
                + '</div>';
            }
          });

          container.innerHTML = html;
        });
    }

    function retryTask(taskId) {
      fetch(apiUrl('/tasks/' + taskId + '/retry'), {
        method: 'POST',
        credentials: 'include',
      }).then(function(r) {
        if (r.ok) loadTasks(false);
      });
    }

    function esc(s) {
      var d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    loadTasks(true);
  </script>
</body>
</html>`;
}
