import { createAuth } from "./auth";

export { CompanyDO } from "./company-do";

export interface Env {
  DB: D1Database;
  COMPANY_DO: DurableObjectNamespace;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  RESEND_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  PARALLEL_API_KEY?: string;
}

interface Company {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string | null;
  method: string;
  source_input: string | null;
  created_at: string;
}

function generateId() {
  return crypto.randomUUID();
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const auth = createAuth(env);

    // Handle all Better Auth routes (/api/auth/*)
    if (url.pathname.startsWith("/api/auth")) {
      return auth.handler(request);
    }

    // --- API: Companies ---
    if (url.pathname === "/api/companies") {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session)
        return Response.json({ error: "Unauthorized" }, { status: 401 });

      if (request.method === "POST") {
        const body = await request.json<{
          method: string;
          sourceInput?: string;
        }>();
        const id = generateId();
        const now = new Date().toISOString();

        // Generate a name based on method
        let name: string;
        if (body.method === "describe") {
          name = (body.sourceInput || "").slice(0, 60) || "My Company";
        } else if (body.method === "website") {
          try {
            name = new URL(body.sourceInput || "").hostname;
          } catch {
            name = "Website Company";
          }
        } else {
          name = "Surprise Co. #" + id.slice(0, 4);
        }

        // Generate a Twitter-style slug (letters, numbers, underscores only)
        const slug =
          name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "")
            .slice(0, 11) || id.slice(0, 8);
        // Ensure uniqueness by appending short id suffix
        const finalSlug = slug + "_" + id.slice(0, 4);

        await env.DB.prepare(
          `INSERT INTO "company" (id, user_id, name, slug, description, method, source_input, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            id,
            session.user.id,
            name,
            finalSlug,
            body.sourceInput || null,
            body.method,
            body.sourceInput || null,
            now
          )
          .run();

        // Kick the Durable Object so it initializes
        const doId = env.COMPANY_DO.idFromName(id);
        const stub = env.COMPANY_DO.get(doId);
        await stub.fetch(new Request("https://do/data"));

        return Response.json({ id });
      }

      if (request.method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT * FROM "company" WHERE user_id = ? ORDER BY created_at DESC`
        )
          .bind(session.user.id)
          .all<Company>();
        return Response.json({ companies: results });
      }

      return new Response("Method not allowed", { status: 405 });
    }

    // --- API: Proxy to Company DO ---
    const companyApiMatch = url.pathname.match(
      /^\/api\/company\/([^/]+)(\/.*)/
    );
    if (companyApiMatch) {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session)
        return Response.json({ error: "Unauthorized" }, { status: 401 });

      const companyId = companyApiMatch[1];
      const doPath = companyApiMatch[2]; // e.g. /data, /documents, /documents/doc-1

      // Verify ownership
      const company = await env.DB.prepare(
        `SELECT * FROM "company" WHERE id = ? AND user_id = ?`
      )
        .bind(companyId, session.user.id)
        .first<Company>();
      if (!company)
        return Response.json({ error: "Not found" }, { status: 404 });

      const doId = env.COMPANY_DO.idFromName(companyId);
      const stub = env.COMPANY_DO.get(doId);

      // --- Send email via Resend ---
      if (doPath === "/emails/send" && request.method === "POST") {
        const body = await request.json<{
          to: string;
          subject: string;
          body: string;
        }>();
        if (!body.to || !body.subject || !body.body) {
          return Response.json(
            { error: "to, subject, and body are required" },
            { status: 400 }
          );
        }

        const fromAddr = `${company.slug}@openpolsia.com`;

        // Send via Resend API
        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: `${company.name} <${fromAddr}>`,
            to: [body.to],
            subject: body.subject,
            text: body.body
          })
        });

        if (!resendRes.ok) {
          const err = await resendRes.text();
          return Response.json(
            { error: "Failed to send email", details: err },
            { status: 502 }
          );
        }

        // Store the sent email in the DO
        await stub.fetch(
          new Request("https://do/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subject: body.subject,
              body: body.body,
              from_addr: fromAddr,
              to_addr: body.to
            })
          })
        );

        const resendData = await resendRes.json();
        return Response.json({ ok: true, resend_id: (resendData as any).id });
      }

      // Forward to DO with company metadata headers
      const doHeaders = new Headers(request.headers);
      doHeaders.set("x-company-slug", company.slug);
      doHeaders.set("x-company-name", company.name);
      doHeaders.set("x-user-email", session.user.email || "");
      doHeaders.set("x-user-name", session.user.name || "");

      return stub.fetch(
        new Request("https://do" + doPath, {
          method: request.method,
          headers: doHeaders,
          body:
            request.method !== "GET" && request.method !== "HEAD"
              ? request.body
              : undefined
        })
      );
    }

    // --- Dashboard routes: /dashboard, /dashboard/:id, /dashboard/:id/(documents|emails|tasks) ---
    const dashboardMatch = url.pathname.match(
      /^\/dashboard(?:\/([^/]+)(?:\/(documents|emails|tasks))?)?$/
    );
    if (dashboardMatch) {
      const session = await auth.api.getSession({ headers: request.headers });

      if (!session) {
        const signInRes = await auth.api.signInSocial({
          body: { provider: "google", callbackURL: url.pathname }
        });
        if (signInRes.url) return Response.redirect(signInRes.url, 302);
        return Response.redirect(url.origin, 302);
      }

      const { results: companies } = await env.DB.prepare(
        `SELECT * FROM "company" WHERE user_id = ? ORDER BY created_at DESC`
      )
        .bind(session.user.id)
        .all<Company>();

      const companyIdParam = dashboardMatch[1];
      const subpage = dashboardMatch[2]; // "documents", "emails", "tasks", or undefined

      // /dashboard — pick first company or show empty
      const selectedId =
        companyIdParam || (companies.length > 0 ? companies[0].id : null);
      const selectedCompany =
        companies.find((c) => c.id === selectedId) || null;

      // If a company ID was given but doesn't exist, redirect to /dashboard
      if (companyIdParam && !selectedCompany) {
        return Response.redirect(url.origin + "/dashboard", 302);
      }

      // /dashboard/:id/documents
      if (subpage === "documents" && selectedCompany) {
        return new Response(documentsPageHTML(selectedCompany), {
          headers: { "Content-Type": "text/html;charset=utf-8" }
        });
      }

      // /dashboard/:id/emails
      if (subpage === "emails" && selectedCompany) {
        return new Response(emailsPageHTML(selectedCompany), {
          headers: { "Content-Type": "text/html;charset=utf-8" }
        });
      }

      // /dashboard/:id/tasks
      if (subpage === "tasks" && selectedCompany) {
        return new Response(tasksPageHTML(selectedCompany), {
          headers: { "Content-Type": "text/html;charset=utf-8" }
        });
      }

      // /dashboard or /dashboard/:id
      let companyData = null;
      if (selectedCompany) {
        const doId = env.COMPANY_DO.idFromName(selectedCompany.id);
        const stub = env.COMPANY_DO.get(doId);
        const res = await stub.fetch(new Request("https://do/data"));
        companyData = await res.json();
      }

      const name = session.user.name || session.user.email;
      return new Response(
        dashboardHTML(name, companies, selectedCompany, companyData),
        {
          headers: { "Content-Type": "text/html;charset=utf-8" }
        }
      );
    }

    // Let Cloudflare assets handle everything else
    return new Response(null, { status: 404 });
  },

  async email(message: ForwardableEmailMessage, env: Env) {
    // Extract slug from the "to" address: <slug>@openpolsia.com
    const toAddr = message.to;

    const slug = toAddr.split("@")[0]?.toLowerCase();
    console.log("incoming email", slug);
    if (!slug) {
      message.setReject("Invalid recipient");
      return;
    }

    // Look up company by slug
    const company = await env.DB.prepare(
      `SELECT * FROM "company" WHERE slug = ?`
    )
      .bind(slug)
      .first<Company>();

    if (!company) {
      message.setReject("Unknown recipient");
      return;
    }

    // Read the raw email to extract subject and body
    const rawEmail = await new Response(message.raw).text();
    const subject = message.headers.get("subject") || "(no subject)";

    // Extract a plain text body from the raw email (simple approach)
    let body = "";
    const contentType = message.headers.get("content-type") || "";
    if (contentType.includes("multipart")) {
      // Try to find the text/plain part
      const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/);
      if (boundaryMatch) {
        const boundary = boundaryMatch[1];
        const parts = rawEmail.split("--" + boundary);
        for (const part of parts) {
          if (part.includes("text/plain")) {
            const bodyStart = part.indexOf("\r\n\r\n") || part.indexOf("\n\n");
            if (bodyStart !== -1) {
              body = part.slice(bodyStart + 4).trim();
              break;
            }
          }
        }
      }
      if (!body) {
        // Fallback: try text/html part
        const boundaryMatch2 = contentType.match(/boundary="?([^";\s]+)"?/);
        if (boundaryMatch2) {
          const parts = rawEmail.split("--" + boundaryMatch2[1]);
          for (const part of parts) {
            if (part.includes("text/html")) {
              const bodyStart =
                part.indexOf("\r\n\r\n") || part.indexOf("\n\n");
              if (bodyStart !== -1) {
                body = part
                  .slice(bodyStart + 4)
                  .replace(/<[^>]+>/g, "")
                  .trim();
                break;
              }
            }
          }
        }
      }
    } else {
      // Simple single-part email
      const bodyStart =
        rawEmail.indexOf("\r\n\r\n") || rawEmail.indexOf("\n\n");
      if (bodyStart !== -1) {
        body = rawEmail.slice(bodyStart + 4).trim();
      }
    }

    if (!body) {
      body = "(empty)";
    }

    // Insert email into the company's Durable Object
    const doId = env.COMPANY_DO.idFromName(company.id);
    const stub = env.COMPANY_DO.get(doId);
    await stub.fetch(
      new Request("https://do/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          body,
          from_addr: message.from,
          to_addr: toAddr
        })
      })
    );
  }
};

function dashboardHTML(
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
      <a href="/new" class="topbar-add" title="New company">+</a>`
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
            ${dataCard("Tasks", companyData.tasks.slice(0, 3), (t: any) => `<a href="/dashboard/${cIdSafe}/tasks#${escapeHtml(t.id)}" class="doc-link"><span class="badge badge-${t.status}">${escapeHtml(t.status)}</span> ${escapeHtml(t.title)}</a>`, `/dashboard/${cIdSafe}/tasks`)}
            ${dataCard(`Emails <small style="font-weight:normal;color:#888;font-size:12px">${escapeHtml(selectedCompany.slug)}@openpolsia.com</small>`, companyData.emails.slice(0, 3), (e: any) => `<a href="/dashboard/${cIdSafe}/emails#${escapeHtml(e.id)}" class="doc-link"><strong>${escapeHtml(e.subject)}</strong><br/><small>${escapeHtml(e.from_addr)} → ${escapeHtml(e.to_addr)}</small></a>`, `/dashboard/${cIdSafe}/emails`)}
            ${dataCard("Logs", companyData.logs.slice(0, 5), (l: any) => {
              const badge = l.type === 'tool_call' ? 'badge-in_progress' : 'badge-completed';
              const label = l.type === 'tool_call' ? 'call' : 'result';
              let detail = '';
              try {
                const parsed = JSON.parse(l.content);
                detail = parsed.tool + (parsed.input ? ': ' + JSON.stringify(parsed.input).slice(0, 80) : '');
              } catch { detail = l.content; }
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
    function signOut() {
      fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      }).then(function() { window.location.href = '/'; });
    }

    function loadChat() {
      if (!COMPANY_ID) return;
      fetch('/api/company/' + COMPANY_ID + '/chat', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          renderChat(data.messages);
        });
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
      html = html.replace(/^(?!<[hupbl])(\\S.+)$/gm, '<p>$1</p>');
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

function documentsPageHTML(company: Company) {
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
      // Paragraphs (lines not already wrapped)
      html = html.replace(/^(?!<[hupbl])(\\S.+)$/gm, '<p>$1</p>');
      return html;
    }

    loadDocuments(true);
  </script>
</body>
</html>`;
}

function tasksPageHTML(company: Company) {
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
      allTasks.forEach(function(t) { if (cats[t.status] !== undefined) cats[t.status]++; });
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
        filteredTasks = allTasks.filter(function(t) { return t.status === currentFilter; });
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
        return '<div class="task-item' + active + '" onclick="selectTaskById(\\'' + t.id + '\\')">'
          + '<div class="task-title">' + esc(t.title) + '</div>'
          + '<div class="task-meta">'
          + '<span class="badge badge-' + t.status + '">' + esc(t.status) + '</span>'
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
        '<span class="badge badge-' + selectedTask.status + '">' + esc(selectedTask.status) + '</span>'
        + (selectedTask.assigned_to ? '<span>Assigned to: <strong>' + esc(selectedTask.assigned_to) + '</strong></span>' : '')
        + '<span>' + new Date(selectedTask.created_at).toLocaleString() + '</span>';

      if (selectedTask.description) {
        content.innerHTML = '<div class="task-description">' + esc(selectedTask.description) + '</div>';
      } else {
        content.innerHTML = '<div class="empty-state" style="color:#bbb">No description</div>';
      }
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

function emailsPageHTML(company: Company) {
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
      html = html.replace(/^(?!<[hupbl])(\\S.+)$/gm, '<p>$1</p>');
      return html;
    }

    loadEmails(true);
  </script>
</body>
</html>`;
}

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
