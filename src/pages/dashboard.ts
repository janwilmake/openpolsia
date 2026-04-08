import { Company, escapeHtml } from "../types";

function dataCard(
  title: string,
  items: any[],
  renderItem: (item: any) => string,
  showAllHref?: string | null
): string {
  const showAllLink = showAllHref
    ? `<a href="${showAllHref}" class="show-all">Manage →</a>`
    : "";
  if (!items || items.length === 0) {
    return `<div class="section"><h3>${title}</h3><div class="section-item" style="color:#aaa">No ${title.replace(/<[^>]*>/g, '').toLowerCase()} yet</div></div>`;
  }
  return `<div class="section"><h3>${title} ${showAllLink}</h3>${items.map((item) => `<div class="section-item">${renderItem(item)}</div>`).join("")}</div>`;
}

export interface BillingData {
  hasActiveSubscription: boolean;
  taskCredits: number;
  tasksUsed: number;
  subscribedCompanyCount: number;
}

export function dashboardHTML(
  userName: string,
  companies: Company[],
  selectedCompany: Company | null,
  companyData: any,
  host: string,
  billing?: BillingData
) {
  const isLocal = host.includes("localhost");
  const baseDomain = isLocal ? `localhost.localhost:${host.split(":")[1] || "8787"}` : "openpolsia.com";
  const protocol = isLocal ? "http" : "https";
  const eName = escapeHtml(userName);

  // Determine if selected company is over the subscription limit
  // Companies ordered by created_at ASC; index >= subscribedCompanyCount means over limit
  const subscribedCount = billing?.subscribedCompanyCount ?? 0;
  const isSubscribed = billing?.hasActiveSubscription ?? false;
  let selectedCompanyOverLimit = false;
  if (isSubscribed && selectedCompany) {
    const sortedByCreation = [...companies].sort(
      (a, b) => a.created_at.localeCompare(b.created_at)
    );
    const idx = sortedByCreation.findIndex((c) => c.id === selectedCompany.id);
    selectedCompanyOverLimit = idx >= subscribedCount;
  }

  const atCompanyLimit = isSubscribed && companies.length >= subscribedCount;
  const companySwitcher =
    companies.length > 0
      ? `<select id="company-select" onchange="switchCompany(this.value)">
        ${companies.map((c) => `<option value="${escapeHtml(c.id)}" ${selectedCompany && c.id === selectedCompany.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
      </select>
      ${atCompanyLimit
        ? `<a onclick="openBillingModal()" class="topbar-btn" title="Upgrade to add more companies">+ New</a>`
        : `<a href="/new" class="topbar-btn" title="New company">+ New</a>`}
      <a onclick="deleteCompany()" class="topbar-btn topbar-delete" title="Delete company">&times;</a>`
      : "";

  const cIdSafe = selectedCompany ? escapeHtml(selectedCompany.id) : "";

  const companySection =
    selectedCompany && companyData
      ? `
        <div class="columns">
            <div class="col">
              ${dataCard("Tasks", companyData.tasks.slice(0, 5), (t: any) => { const ds = t.recurrence ? "recurring" : t.status; return `<a href="/dashboard/${cIdSafe}/tasks#${escapeHtml(t.id)}" class="item-link"><strong>${escapeHtml(t.title)}</strong><div class="item-desc">${escapeHtml(t.description || '').slice(0, 120)}${(t.description || '').length > 120 ? '...' : ''}</div><div class="item-meta"><span class="badge badge-${ds}">${escapeHtml(ds)}</span></div></a>`; }, `/dashboard/${cIdSafe}/tasks`)}
            </div>
            <div class="col">
              ${dataCard("Documents", companyData.documents.slice(0, 5), (d: any) => `<a href="/dashboard/${cIdSafe}/documents#${escapeHtml(d.id)}" class="item-link"><strong>${escapeHtml(d.title)}</strong></a>`, `/dashboard/${cIdSafe}/documents`)}
            </div>
            <div class="col">
              ${billing && !billing.hasActiveSubscription ? `
              <div class="section billing-card">
                <h3>Business</h3>
                <div class="section-item" style="text-align:center;padding:16px 0">
                  <div style="font-size:18px;font-weight:700;margin-bottom:4px">Hire Your AI Employee</div>
                  <div style="font-size:13px;color:#666;margin-bottom:12px">$1.63/day &middot; Works while you sleep</div>
                  <button onclick="openBillingModal()" class="billing-btn">Start free trial</button>
                  <div style="font-size:11px;color:#999;margin-top:8px">3-day trial &middot; $49/mo</div>
                </div>
              </div>` : ''}
              ${billing && billing.hasActiveSubscription ? `
              <div class="section billing-card">
                <h3>Business</h3>
                <div class="section-item">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <span class="badge badge-completed">Active</span>
                    <a onclick="manageSubscription()" style="font-size:12px;color:#666;cursor:pointer;text-decoration:underline">Manage</a>
                  </div>
                  <div style="margin-top:10px;font-size:13px;color:#555">
                    Task credits: <strong>${billing.taskCredits - billing.tasksUsed}</strong> remaining
                  </div>
                  ${billing.taskCredits - billing.tasksUsed < 10 ? `<button onclick="buyTasks()" class="billing-btn billing-btn-sm" style="margin-top:8px">Buy more tasks ($1/task)</button>` : ''}
                </div>
              </div>` : ''}
              <div class="section">
                <h3>Links</h3>
                <div class="section-item"><a href="${protocol}://${escapeHtml(selectedCompany.slug)}.${baseDomain}" target="_blank" class="item-link">${escapeHtml(selectedCompany.slug)}.${baseDomain}</a></div>
              </div>
              ${dataCard(`Email`, companyData.emails.slice(0, 3), (e: any) => { const out = e.from_addr.toLowerCase().endsWith('@openpolsia.com'); return `<a href="/dashboard/${cIdSafe}/emails#${escapeHtml(e.id)}" class="item-link"><span class="email-dir">${out ? '→' : '←'}</span> <strong>${escapeHtml(e.subject)}</strong><div class="item-meta">${out ? 'To' : 'From'}: ${escapeHtml(out ? e.to_addr : e.from_addr)}</div></a>`; }, `/dashboard/${cIdSafe}/emails`)}
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
      font-family: Georgia, 'Times New Roman', serif;
      color: #111;
      background: #fff;
    }

    /* Topbar */
    .topbar {
      border-bottom: 1px solid #ddd;
      padding: 16px 24px;
      margin-right: 420px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 14px;
    }
    @media (max-width: 1100px) {
      .topbar { margin-right: 0; }
    }
    .topbar-left {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .topbar h1 {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 28px;
      font-weight: 700;
      font-style: italic;
    }
    .topbar select {
      background: #fff;
      color: #111;
      border: 1px solid #ccc;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 13px;
      font-family: inherit;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .topbar-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 4px 12px;
      background: #fff;
      color: #111;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 13px;
      text-decoration: none;
      cursor: pointer;
    }
    .topbar-btn:hover { background: #f5f5f5; }
    .topbar-delete { color: #c0392b; border-color: #ddd; }
    .topbar-delete:hover { background: #fdf0f0; }
    .topbar-right {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 13px;
    }
    .topbar-right span { color: #888; }
    .topbar-right a {
      color: #888;
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
    }
    .topbar-right a:hover { color: #111; }

    /* Layout */
    .container {
      margin-right: 420px;
      padding: 24px;
    }
    .columns {
      display: flex;
      gap: 0;
    }
    .col {
      flex: 1;
      min-width: 0;
      padding: 0 24px;
      border-right: 1px solid #ddd;
    }
    .col:first-child { padding-left: 0; }
    .col:last-child { border-right: none; }
    @media (max-width: 1100px) {
      .container { margin-right: 0; }
    }
    @media (max-width: 900px) {
      .columns { flex-direction: column; }
      .col { padding: 0; border-right: none; border-bottom: 1px solid #ddd; padding-bottom: 16px; margin-bottom: 16px; }
      .col:last-child { border-bottom: none; }
    }

    /* Sections */
    .section {
      margin-bottom: 28px;
    }
    .section h3 {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 18px;
      font-weight: 700;
      padding-bottom: 8px;
      border-bottom: 2px solid #111;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    .show-all {
      font-size: 13px;
      font-weight: normal;
      color: #666;
      text-decoration: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    }
    .show-all:hover { text-decoration: underline; }

    /* Section items */
    .section-item {
      padding: 10px 0;
      border-bottom: 1px solid #eee;
      font-size: 15px;
      line-height: 1.5;
    }
    .section-item:last-child { border-bottom: none; }
    .item-link {
      color: inherit;
      text-decoration: none;
      display: block;
    }
    .item-link:hover { color: #555; }
    .item-link strong {
      font-size: 15px;
    }
    .item-desc {
      font-size: 13px;
      color: #555;
      margin-top: 3px;
      line-height: 1.4;
    }
    .item-meta {
      margin-top: 4px;
      font-size: 12px;
      color: #888;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    }
    .email-dir {
      font-size: 13px;
      color: #888;
    }
    /* Badges */
    .badge {
      display: inline-block;
      padding: 1px 7px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    }
    .badge-todo { background: #e2e3e5; color: #383d41; }
    .badge-in_progress { background: #cce5ff; color: #004085; }
    .badge-completed { background: #d4edda; color: #155724; }
    .badge-recurring { background: #e8daef; color: #6c3483; }
    .badge-rejected { background: #f5b7b1; color: #78281f; }
    .badge-failed { background: #f8d7da; color: #721c24; }

    /* Chat FAB — visible by default (chat starts closed) */
    .chat-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 12px 24px;
      background: #111;
      color: #fff;
      border: none;
      border-radius: 24px;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15);
      z-index: 1000;
      display: block;
    }
    .chat-fab:hover { background: #333; }

    /* Chat widget — fixed right column on large screens */
    .chat-widget {
      position: fixed;
      top: 0;
      right: 0;
      width: 420px;
      height: 100vh;
      background: #fff;
      border-left: 1px solid #ddd;
      display: flex;
      flex-direction: column;
      z-index: 1001;
      overflow: hidden;
    }
    /* On large screens, hide when closed — show FAB to reopen */
    .chat-widget.closed { display: none; }
    .chat-fab.hidden { display: none !important; }

    /* On smaller screens, convert to floating popup */
    @media (max-width: 1100px) {
      .chat-widget {
        top: auto;
        bottom: 24px;
        right: 24px;
        width: 400px;
        height: 520px;
        border: 1px solid #ddd;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.12);
        display: none;
      }
      .chat-widget.open { display: flex; }
      .chat-widget.closed { display: none; }
    }
    @media (max-width: 700px) {
      .chat-widget {
        width: 100vw;
        height: 100vh;
        bottom: 0;
        right: 0;
        border-radius: 0;
        border: none;
        box-shadow: none;
      }
    }
    .chat-header {
      padding: 14px 20px;
      font-size: 18px;
      font-weight: 700;
      border-bottom: 1px solid #ddd;
      flex-shrink: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .chat-close {
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #888;
      line-height: 1;
      padding: 0 4px;
    }
    .chat-close:hover { color: #111; }
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
    }
    .chat-msg {
      margin-bottom: 14px;
      font-size: 14px;
      line-height: 1.6;
    }
    .chat-msg .chat-role {
      font-weight: 700;
      font-size: 11px;
      text-transform: uppercase;
      margin-bottom: 2px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      letter-spacing: 0.3px;
    }
    .chat-msg.chat-user .chat-role { color: #2980b9; }
    .chat-msg.chat-agent .chat-role { color: #888; }
    .chat-msg .chat-text { color: #222; }
    .chat-msg .chat-text.rendered-md { font-size: 14px; line-height: 1.6; }
    .chat-msg .chat-text.rendered-md p { margin-bottom: 6px; }
    .chat-msg .chat-text.rendered-md pre { padding: 8px; font-size: 12px; }
    .chat-msg .chat-text.rendered-md h1, .chat-msg .chat-text.rendered-md h2, .chat-msg .chat-text.rendered-md h3 { margin: 8px 0 4px; }
    .chat-msg .chat-text.rendered-md ul { margin: 0 0 6px 16px; }
    .chat-input-area {
      display: flex;
      border-top: 1px solid #ddd;
      flex-shrink: 0;
      align-items: center;
    }
    .chat-input-area input {
      flex: 1;
      border: none;
      padding: 14px 20px;
      font-size: 15px;
      outline: none;
      font-family: Georgia, 'Times New Roman', serif;
      background: transparent;
    }
    .chat-send {
      padding: 14px 20px;
      background: none;
      color: #111;
      border: none;
      font-size: 20px;
      cursor: pointer;
    }
    .chat-send:hover { color: #555; }
    .chat-send:disabled { opacity: 0.3; cursor: not-allowed; }
    .chat-streaming::after {
      content: '\\25CF';
      animation: blink 1s infinite;
      margin-left: 2px;
    }
    @keyframes blink { 50% { opacity: 0; } }

    /* Tool call/result in chat */
    .chat-tool {
      margin-bottom: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 12px;
      border-radius: 6px;
      overflow: hidden;
    }
    .chat-tool-header {
      padding: 6px 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
    }
    .chat-tool-call .chat-tool-header { background: #f0f4ff; color: #004085; }
    .chat-tool-result .chat-tool-header { background: #f0faf0; color: #155724; }
    .chat-tool-toggle { font-size: 10px; transition: transform 0.15s; }
    .chat-tool.open .chat-tool-toggle { transform: rotate(90deg); }
    .chat-tool-name { font-weight: 600; }
    .chat-tool-body {
      display: none;
      padding: 6px 10px;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      font-size: 11px;
      line-height: 1.4;
      max-height: 150px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .chat-tool-call .chat-tool-body { background: #f7f9ff; color: #333; }
    .chat-tool-result .chat-tool-body { background: #f7fdf7; color: #333; }
    .chat-tool.open .chat-tool-body { display: block; }

    /* Billing modal */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.4);
      z-index: 2000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .modal-box {
      background: #fff;
      border-radius: 12px;
      width: 420px;
      max-width: 90vw;
      box-shadow: 0 8px 30px rgba(0,0,0,0.15);
      overflow: hidden;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 24px 0;
    }
    .modal-body {
      padding: 20px 24px 24px;
    }

    /* Billing card */
    .billing-btn {
      display: inline-block;
      padding: 10px 24px;
      background: #111;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .billing-btn:hover { background: #333; }
    .billing-btn-sm { padding: 6px 16px; font-size: 12px; }

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
      .topbar { border-bottom-color: #333; }
      .topbar select { background: #1e1e1e; color: #e0e0e0; border-color: #444; }
      .topbar-btn { background: #1e1e1e; color: #e0e0e0; border-color: #444; }
      .topbar-btn:hover { background: #2a2a2a; }
      .topbar-delete { color: #e74c3c; }
      .topbar-delete:hover { background: #2a1515; }
      .topbar-right span { color: #888; }
      .topbar-right a { color: #888; }
      .topbar-right a:hover { color: #e0e0e0; }
      .col { border-right-color: #333; }
      .section h3 { border-bottom-color: #e0e0e0; }
      .section-item { border-bottom-color: #2a2a2a; }
      .item-link { color: #e0e0e0; }
      .item-link:hover { color: #bbb; }
      .item-desc { color: #999; }
      .item-meta { color: #777; }
      .show-all { color: #999; }
      .billing-btn { background: #e0e0e0; color: #111; }
      .billing-btn:hover { background: #ccc; }
      .modal-box { background: #1e1e1e; }
      .modal-box select { background: #2a2a2a; color: #e0e0e0; border-color: #444; }
      .chat-fab { background: #e0e0e0; color: #111; }
      .chat-fab:hover { background: #ccc; }
      .chat-widget { background: #1e1e1e; border-color: #333; }
      .chat-header { border-bottom-color: #333; }
      .chat-close { color: #888; }
      .chat-close:hover { color: #e0e0e0; }
      .chat-msg .chat-text { color: #ccc; }
      .chat-tool-call .chat-tool-header { background: #1a2233; color: #6fa8dc; }
      .chat-tool-result .chat-tool-header { background: #1a2a1a; color: #6fcf6f; }
      .chat-tool-call .chat-tool-body { background: #141c2a; color: #ccc; }
      .chat-tool-result .chat-tool-body { background: #142014; color: #ccc; }
      .chat-input-area { border-top-color: #333; }
      .chat-input-area input { color: #e0e0e0; }
      .chat-send { color: #e0e0e0; }
      .chat-send:hover { color: #999; }
      .empty { color: #999; }
      .empty a { color: #e0e0e0; }
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

  <div class="container" id="dashboard-content">
    ${companySection}
  </div>

  <!-- Billing Modal -->
  <div class="modal-overlay" id="billing-modal" style="display:none" onclick="if(event.target===this)closeBillingModal()">
    <div class="modal-box">
      <div class="modal-header">
        <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:700" id="billing-modal-title">Subscribe to Open Polsia</h2>
        <button class="chat-close" onclick="closeBillingModal()">&times;</button>
      </div>
      <div class="modal-body" id="billing-modal-new">
        <div style="margin-bottom:20px">
          <div style="font-size:15px;margin-bottom:8px"><strong>AI Employee Companies</strong></div>
          <div style="font-size:13px;color:#666;margin-bottom:12px">$49/mo per company &middot; 3-day free trial</div>
          <div style="display:flex;align-items:center;gap:12px">
            <label style="font-size:13px">Number of companies:</label>
            <select id="billing-qty" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:14px">
              <option value="1">1 company</option>
              <option value="2">2 companies</option>
              <option value="3">3 companies</option>
              <option value="5">5 companies</option>
              <option value="10">10 companies</option>
            </select>
          </div>
        </div>
        <div style="border-top:1px solid #eee;padding-top:16px;margin-bottom:16px">
          <div style="font-size:13px;color:#666" id="billing-summary">Total: $49/mo (3-day free trial)</div>
        </div>
        <button onclick="startCheckout()" class="billing-btn" style="width:100%;padding:12px">Start free trial</button>
        <div style="font-size:11px;color:#999;text-align:center;margin-top:8px">You can cancel anytime during the trial</div>
      </div>
      <div class="modal-body" id="billing-modal-upgrade" style="display:none">
        <div style="margin-bottom:16px">
          <div style="font-size:15px;margin-bottom:8px"><strong>Company limit reached</strong></div>
          <div style="font-size:13px;color:#666;margin-bottom:12px">You're subscribed to <strong>${subscribedCount}</strong> ${subscribedCount === 1 ? 'company' : 'companies'} but have <strong>${companies.length}</strong>. Increase your plan to add more.</div>
          <div style="display:flex;align-items:center;gap:12px">
            <label style="font-size:13px">New company count:</label>
            <select id="upgrade-qty" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:14px">
              ${[2, 3, 5, 10, 15, 20].filter(n => n > subscribedCount).map(n => `<option value="${n}"${n === companies.length + 1 ? ' selected' : ''}>${n} companies</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="border-top:1px solid #eee;padding-top:16px;margin-bottom:16px">
          <div style="font-size:13px;color:#666" id="upgrade-summary"></div>
        </div>
        <button onclick="submitUpgrade()" id="upgrade-btn" class="billing-btn" style="width:100%;padding:12px">Upgrade plan</button>
        <div style="font-size:11px;color:#999;text-align:center;margin-top:8px">Prorated charges apply immediately</div>
      </div>
    </div>
  </div>

  <button class="chat-fab" id="chat-fab" onclick="toggleChat()">Chat</button>
  <div class="chat-widget closed" id="chat-widget">
    <div class="chat-header">
      <span>Chat</span>
      <button class="chat-close" onclick="toggleChat()">&times;</button>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    ${selectedCompanyOverLimit ? `
    <div style="padding:12px 20px;border-top:1px solid #ddd;font-size:13px;color:#888;text-align:center">
      Chat disabled — this company exceeds your subscription limit. <a onclick="manageSubscription()" style="color:#111;cursor:pointer;text-decoration:underline">Upgrade</a>
    </div>` : `
    <div class="chat-input-area">
      <input type="text" id="chat-input" placeholder="Ask Polsia anything..." onkeydown="if(event.key==='Enter')sendMessage()" />
      <button class="chat-send" onclick="sendMessage()">→</button>
    </div>`}
  </div>

  <script>
    var COMPANY_ID = '${cIdSafe}';
    var COMPANY_SLUG = '${selectedCompany ? escapeHtml(selectedCompany.slug) : ""}';
    var BASE_DOMAIN = '${baseDomain}';
    var PROTOCOL = '${protocol}';
    var COMPANY_OVER_LIMIT = ${selectedCompanyOverLimit ? "true" : "false"};

    function isSmallScreen() {
      return window.innerWidth <= 1100;
    }

    function toggleChat() {
      var widget = document.getElementById('chat-widget');
      var fab = document.getElementById('chat-fab');
      if (isSmallScreen()) {
        var isOpen = widget.classList.toggle('open');
        widget.classList.remove('closed');
        fab.classList.toggle('hidden', isOpen);
        try { localStorage.setItem('chatOpen', isOpen ? '1' : '0'); } catch(e) {}
        if (isOpen) {
          var input = document.getElementById('chat-input');
          if (input) input.focus();
          var el = document.getElementById('chat-messages');
          if (el) el.scrollTop = el.scrollHeight;
        }
      } else {
        var isClosed = widget.classList.toggle('closed');
        fab.classList.toggle('hidden', !isClosed);
        try { localStorage.setItem('chatOpen', isClosed ? '0' : '1'); } catch(e) {}
        if (!isClosed) {
          var input = document.getElementById('chat-input');
          if (input) input.focus();
          var el = document.getElementById('chat-messages');
          if (el) el.scrollTop = el.scrollHeight;
        }
      }
    }

    // Restore chat state from localStorage
    (function() {
      var widget = document.getElementById('chat-widget');
      var fab = document.getElementById('chat-fab');
      try {
        if (localStorage.getItem('chatOpen') === '1') {
          if (widget) { widget.classList.remove('closed'); if (isSmallScreen()) widget.classList.add('open'); }
          if (fab) fab.classList.add('hidden');
        }
      } catch(e) {}
    })();

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

    var IS_SUBSCRIBED = ${isSubscribed ? "true" : "false"};
    var AT_COMPANY_LIMIT = ${atCompanyLimit ? "true" : "false"};

    function openBillingModal() {
      document.getElementById('billing-modal').style.display = 'flex';
      if (IS_SUBSCRIBED && AT_COMPANY_LIMIT) {
        document.getElementById('billing-modal-title').textContent = 'Upgrade your plan';
        document.getElementById('billing-modal-new').style.display = 'none';
        document.getElementById('billing-modal-upgrade').style.display = 'block';
      } else {
        document.getElementById('billing-modal-title').textContent = 'Subscribe to Open Polsia';
        document.getElementById('billing-modal-new').style.display = 'block';
        document.getElementById('billing-modal-upgrade').style.display = 'none';
        updateBillingSummary();
      }
    }
    function closeBillingModal() {
      document.getElementById('billing-modal').style.display = 'none';
    }
    function updateBillingSummary() {
      var qty = parseInt(document.getElementById('billing-qty').value, 10) || 1;
      document.getElementById('billing-summary').textContent = 'Total: $' + (qty * 49) + '/mo (3-day free trial)';
    }
    // Attach change listener
    (function() {
      var sel = document.getElementById('billing-qty');
      if (sel) sel.addEventListener('change', updateBillingSummary);
    })();

    function startCheckout() {
      var qty = parseInt(document.getElementById('billing-qty').value, 10) || 1;
      fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ quantity: qty }),
      }).then(function(r) { return r.json(); })
        .then(function(data) { if (data.url) window.location.href = data.url; });
    }

    function buyTasks() {
      var qty = prompt('How many task credits to purchase? ($1 each)', '10');
      if (!qty) return;
      var n = parseInt(qty, 10);
      if (!n || n < 1) return;
      fetch('/api/billing/buy-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ quantity: n }),
      }).then(function(r) { return r.json(); })
        .then(function(data) { if (data.url) window.location.href = data.url; });
    }

    function updateUpgradeSummary() {
      var el = document.getElementById('upgrade-qty');
      var summary = document.getElementById('upgrade-summary');
      if (!el || !summary) return;
      var qty = parseInt(el.value, 10) || 1;
      summary.textContent = 'New total: $' + (qty * 49) + '/mo for ' + qty + ' companies';
    }
    (function() {
      var sel = document.getElementById('upgrade-qty');
      if (sel) {
        sel.addEventListener('change', updateUpgradeSummary);
        updateUpgradeSummary();
      }
    })();

    function submitUpgrade() {
      var qty = parseInt(document.getElementById('upgrade-qty').value, 10);
      if (!qty) return;
      var btn = document.getElementById('upgrade-btn');
      btn.textContent = 'Upgrading...';
      btn.disabled = true;
      fetch('/api/billing/update-quantity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ quantity: qty }),
      }).then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.ok) {
            window.location.reload();
          } else {
            btn.textContent = 'Upgrade plan';
            btn.disabled = false;
            alert(data.error || 'Failed to upgrade');
          }
        }).catch(function() {
          btn.textContent = 'Upgrade plan';
          btn.disabled = false;
          alert('Network error');
        });
    }

    function manageSubscription() {
      fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      }).then(function(r) { return r.json(); })
        .then(function(data) { if (data.url) window.location.href = data.url; });
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
        if (m.type === 'tool_call' || m.type === 'tool_result') {
          return renderToolMsg(m);
        }
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
      if (COMPANY_OVER_LIMIT) return;
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
        var contentBlocks = []; // {type:'text',content:''} | {type:'tool_call',...} | {type:'tool_result',...}
        var currentText = null;
        var ndjsonBuf = '';

        function addTextDelta(delta) {
          if (!currentText) {
            currentText = { type: 'text', content: '' };
            contentBlocks.push(currentText);
          }
          currentText.content += delta;
        }

        function addToolEvent(ev) {
          currentText = null;
          contentBlocks.push(ev);
        }

        function renderBlocks() {
          var html = '';
          for (var i = 0; i < contentBlocks.length; i++) {
            var block = contentBlocks[i];
            if (block.type === 'text') {
              html += '<div class="rendered-md">' + renderMarkdown(block.content) + '</div>';
            } else {
              html += renderToolMsg({
                type: block.type,
                content: JSON.stringify(block.type === 'tool_call'
                  ? { tool: block.tool, input: block.input }
                  : { tool: block.tool, result: block.result })
              });
            }
          }
          return html;
        }

        function read() {
          reader.read().then(function(result) {
            if (result.done) {
              isSending = false;
              textEl.classList.remove('chat-streaming');
              textEl.innerHTML = renderBlocks();
              el.scrollTop = el.scrollHeight;
              // Reload from DB to get canonical ordering
              loadChat();
              return;
            }
            ndjsonBuf += decoder.decode(result.value, { stream: true });
            var lines = ndjsonBuf.split('\\n');
            ndjsonBuf = lines.pop();
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i].trim();
              if (!line) continue;
              try {
                var ev = JSON.parse(line);
                if (ev.t === 'd') {
                  addTextDelta(ev.v);
                } else if (ev.t === 'c') {
                  addToolEvent({ type: 'tool_call', tool: ev.tool, input: ev.input });
                } else if (ev.t === 'r') {
                  addToolEvent({ type: 'tool_result', tool: ev.tool, result: ev.result });
                }
              } catch(e) {
                addTextDelta(line);
              }
            }
            textEl.innerHTML = renderBlocks();
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

    function renderToolMsg(m) {
      var isCall = m.type === 'tool_call';
      var cls = isCall ? 'chat-tool-call' : 'chat-tool-result';
      var parsed = {};
      try { parsed = JSON.parse(m.content); } catch(e) {}
      var toolName = parsed.tool || 'unknown';
      var label = isCall ? 'Called' : 'Result';
      var body = isCall
        ? JSON.stringify(parsed.input || {}, null, 2)
        : JSON.stringify(parsed.result || parsed, null, 2);
      return '<div class="chat-tool ' + cls + '" onclick="this.classList.toggle(&quot;open&quot;)">'
        + '<div class="chat-tool-header">'
        + '<span class="chat-tool-toggle">▶</span>'
        + '<span class="chat-tool-name">' + esc(label + ': ' + toolName) + '</span>'
        + '</div>'
        + '<div class="chat-tool-body">' + esc(body) + '</div>'
        + '</div>';
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

    // --- SSE auto-update ---
    function renderSection(title, items, renderItem, showAllHref) {
      var showAllLink = showAllHref ? '<a href="' + showAllHref + '" class="show-all">Manage →</a>' : '';
      if (!items || items.length === 0) {
        return '<div class="section"><h3>' + esc(title) + '</h3><div class="section-item" style="color:#aaa">No ' + title.toLowerCase() + ' yet</div></div>';
      }
      return '<div class="section"><h3>' + title + ' ' + showAllLink + '</h3>' + items.map(function(item) {
        return '<div class="section-item">' + renderItem(item) + '</div>';
      }).join('') + '</div>';
    }

    function refreshDashboard() {
      if (!COMPANY_ID) return;
      fetch('/api/company/' + COMPANY_ID + '/data', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var el = document.getElementById('dashboard-content');
          if (!el || !data.tasks) return;

          var cId = COMPANY_ID;
          var tasksHtml = renderSection('Tasks', data.tasks.slice(0, 5), function(t) {
            var ds = t.recurrence ? 'recurring' : t.status;
            return '<a href="/dashboard/' + cId + '/tasks#' + t.id + '" class="item-link">'
              + '<strong>' + esc(t.title) + '</strong>'
              + '<div class="item-desc">' + esc((t.description || '').slice(0, 120)) + ((t.description || '').length > 120 ? '...' : '') + '</div>'
              + '<div class="item-meta"><span class="badge badge-' + ds + '">' + esc(ds) + '</span></div>'
              + '</a>';
          }, '/dashboard/' + cId + '/tasks');

          var docsHtml = renderSection('Documents', data.documents.slice(0, 5), function(d) {
            return '<a href="/dashboard/' + cId + '/documents#' + d.id + '" class="item-link"><strong>' + esc(d.title) + '</strong></a>';
          }, '/dashboard/' + cId + '/documents');

          var emailsHtml = renderSection('Email', data.emails.slice(0, 3), function(e) {
            var out = e.from_addr.toLowerCase().indexOf('@openpolsia.com') !== -1;
            return '<a href="/dashboard/' + cId + '/emails#' + e.id + '" class="item-link">'
              + '<span class="email-dir">' + (out ? '→' : '←') + '</span> '
              + '<strong>' + esc(e.subject) + '</strong>'
              + '<div class="item-meta">' + (out ? 'To' : 'From') + ': ' + esc(out ? e.to_addr : e.from_addr) + '</div>'
              + '</a>';
          }, '/dashboard/' + cId + '/emails');

          var linksHtml = '<div class="section"><h3>Links</h3>'
            + '<div class="section-item"><a href="' + PROTOCOL + '://' + COMPANY_SLUG + '.' + BASE_DOMAIN + '" target="_blank" class="item-link">' + COMPANY_SLUG + '.' + BASE_DOMAIN + '</a></div>'
            + '</div>';

          // Preserve the billing card from the server-rendered HTML
          var billingCardHtml = '';
          var existingBillingCard = el.querySelector('.billing-card');
          if (existingBillingCard) {
            billingCardHtml = existingBillingCard.outerHTML;
          }

          el.innerHTML = '<div class="columns">'
            + '<div class="col">' + tasksHtml + '</div>'
            + '<div class="col">' + docsHtml + '</div>'
            + '<div class="col">' + billingCardHtml + linksHtml + emailsHtml + '</div>'
            + '</div>';
        });
    }

    function connectSSE() {
      if (!COMPANY_ID) return;
      var es = new EventSource('/api/company/' + COMPANY_ID + '/sse');
      es.addEventListener('update', function(e) {
        var data = JSON.parse(e.data || '{}');
        if (data.type === 'company') {
          // Company metadata changed — reload to update topbar
          window.location.reload();
          return;
        }
        refreshDashboard();
        if (data.type === 'chat' && !isSending) loadChat();
      });
      es.addEventListener('connected', function() {});
      es.onerror = function() {
        es.close();
        setTimeout(connectSSE, 3000);
      };
    }

    loadChat();
    connectSSE();
  </script>
</body>
</html>`;
}
