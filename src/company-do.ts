import { DurableObject } from "cloudflare:workers";
import type { Env } from "./worker";
import { runOperator, type OperatorContext } from "./llm-operator";

export class CompanyDO extends DurableObject<Env> {
  private initialized = false;

  private ensureInit() {
    if (this.initialized) return;
    const sql = this.ctx.storage.sql;

    sql.exec(`
      CREATE TABLE IF NOT EXISTS document (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo',
        assigned_to TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_message (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'message',
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS email (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        from_addr TEXT NOT NULL,
        to_addr TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // Migrate: add missing columns
    const migrations: [string, string, string][] = [
      ["task", "description", "TEXT NOT NULL DEFAULT ''"],
      ["task", "assigned_to", "TEXT"],
      ["chat_message", "type", "TEXT NOT NULL DEFAULT 'message'"],
    ];
    for (const [table, col, def] of migrations) {
      try {
        sql.exec(`SELECT ${col} FROM ${table} LIMIT 1`);
      } catch {
        sql.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      }
    }

    // Drop log table if it exists (replaced by chat_message types)
    sql.exec("DROP TABLE IF EXISTS log");

    // Insert dummy data if tables are empty
    const docCount = sql.exec("SELECT COUNT(*) as c FROM document").one()!.c as number;
    if (docCount === 0) {
      const now = new Date().toISOString();
      sql.exec(`
        INSERT INTO document (id, title, content, created_at) VALUES
          ('doc-1', 'Company Vision', 'Build the future of autonomous business operations.', '${now}'),
          ('doc-2', 'Product Roadmap', 'Q1: MVP launch. Q2: Integrations. Q3: Scale.', '${now}');

        INSERT INTO task (id, title, description, status, assigned_to, created_at) VALUES
          ('task-1', 'Set up landing page', 'Design and deploy the initial landing page for the company.', 'completed', 'engineer', '${now}'),
          ('task-2', 'Configure email domain', 'Set up DNS records and email routing for the company domain.', 'todo', 'engineer', '${now}'),
          ('task-3', 'Create first social media post', 'Draft and publish an announcement post on Twitter.', 'in_progress', 'growth', '${now}'),
          ('task-4', 'Send weekly newsletter', 'Compile highlights and send to subscriber list every Monday.', 'recurring', 'growth', '${now}'),
          ('task-5', 'Review competitor pricing', 'Analyse competitor pricing models and report findings.', 'rejected', 'ceo', '${now}'),
          ('task-6', 'Deploy analytics dashboard', 'Set up real-time metrics tracking and alerting.', 'failed', 'engineer', '${now}');

        INSERT INTO chat_message (id, role, content, created_at) VALUES
          ('msg-1', 'user', 'Get started with the company.', '${now}'),
          ('msg-2', 'assistant', 'Company initialized. Landing page deployed successfully.', '${now}');

        INSERT INTO email (id, subject, body, from_addr, to_addr, created_at) VALUES
          ('email-1', 'Welcome to your new company', 'Your autonomous AI company is now live.', 'ai@openpolsia.com', 'founder@example.com', '${now}');
      `);
    }

    this.initialized = true;
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureInit();
    const url = new URL(request.url);
    const sql = this.ctx.storage.sql;

    if (url.pathname === "/data" && request.method === "GET") {
      const documents = [...sql.exec("SELECT * FROM document ORDER BY created_at DESC")];
      const tasks = [...sql.exec("SELECT * FROM task ORDER BY created_at DESC")];
      const chat = [...sql.exec("SELECT * FROM chat_message WHERE type = 'message' ORDER BY created_at ASC")];
      const emails = [...sql.exec("SELECT * FROM email ORDER BY created_at DESC")];
      const logs = [...sql.exec("SELECT * FROM chat_message WHERE type IN ('tool_call', 'tool_result') ORDER BY created_at DESC")];
      return Response.json({ documents, tasks, chat, emails, logs });
    }

    // GET /documents — list all documents
    if (url.pathname === "/documents" && request.method === "GET") {
      const documents = [...sql.exec("SELECT * FROM document ORDER BY created_at DESC")];
      return Response.json({ documents });
    }

    // GET /documents/:id — single document
    const docGetMatch = url.pathname.match(/^\/documents\/([^/]+)$/);
    if (docGetMatch && request.method === "GET") {
      const doc = sql.exec("SELECT * FROM document WHERE id = ?", docGetMatch[1]).one();
      if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json(doc);
    }

    // PUT /documents/:id — update document
    const docPutMatch = url.pathname.match(/^\/documents\/([^/]+)$/);
    if (docPutMatch && request.method === "PUT") {
      const body = await request.json<{ title?: string; content?: string }>();
      const existing = sql.exec("SELECT * FROM document WHERE id = ?", docPutMatch[1]).one();
      if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
      sql.exec(
        "UPDATE document SET title = ?, content = ? WHERE id = ?",
        body.title ?? existing.title,
        body.content ?? existing.content,
        docPutMatch[1]
      );
      const updated = sql.exec("SELECT * FROM document WHERE id = ?", docPutMatch[1]).one();
      return Response.json(updated);
    }

    // DELETE /documents/:id — delete document
    const docDelMatch = url.pathname.match(/^\/documents\/([^/]+)$/);
    if (docDelMatch && request.method === "DELETE") {
      const existing = sql.exec("SELECT * FROM document WHERE id = ?", docDelMatch[1]).one();
      if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
      sql.exec("DELETE FROM document WHERE id = ?", docDelMatch[1]);
      return Response.json({ ok: true });
    }

    // GET /tasks — list all tasks
    if (url.pathname === "/tasks" && request.method === "GET") {
      const tasks = [...sql.exec("SELECT * FROM task ORDER BY created_at DESC")];
      return Response.json({ tasks });
    }

    // GET /chat — list all chat messages (exclude tool_call/tool_result)
    if (url.pathname === "/chat" && request.method === "GET") {
      const messages = [...sql.exec("SELECT * FROM chat_message WHERE type = 'message' ORDER BY created_at ASC")];
      return Response.json({ messages });
    }

    // POST /chat — send a message
    if (url.pathname === "/chat" && request.method === "POST") {
      const body = await request.json<{ content: string }>();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      sql.exec(
        "INSERT INTO chat_message (id, role, content, created_at) VALUES (?, ?, ?, ?)",
        id, "user", body.content, now
      );
      const msg = sql.exec("SELECT * FROM chat_message WHERE id = ?", id).one();
      return Response.json(msg);
    }

    // POST /chat/stream — LLM operator streaming chat
    if (url.pathname === "/chat/stream" && request.method === "POST") {
      const body = await request.json<{ content: string }>();
      const companySlug = request.headers.get("x-company-slug") || "unknown";
      const companyName = request.headers.get("x-company-name") || "Unknown Company";
      const userEmail = request.headers.get("x-user-email") || undefined;
      const userName = request.headers.get("x-user-name") || undefined;

      // Save user message
      const msgId = crypto.randomUUID();
      const now = new Date().toISOString();
      sql.exec(
        "INSERT INTO chat_message (id, role, content, created_at) VALUES (?, ?, ?, ?)",
        msgId, "user", body.content, now
      );

      // Build message history from last 20 messages for context
      const history = [...sql.exec(
        "SELECT role, content FROM chat_message WHERE type = 'message' ORDER BY created_at ASC"
      )].slice(-20).map((m: any) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content as string,
      }));

      const opCtx: OperatorContext = {
        sql,
        companySlug,
        companyName,
        resendApiKey: this.env.RESEND_API_KEY,
        anthropicApiKey: this.env.ANTHROPIC_API_KEY,
        parallelApiKey: this.env.PARALLEL_API_KEY,
        userEmail,
        userName,
      };

      return runOperator(opCtx, history, (text) => {
        if (text.trim()) {
          const assistantId = crypto.randomUUID();
          const assistantNow = new Date().toISOString();
          sql.exec(
            "INSERT INTO chat_message (id, role, content, created_at) VALUES (?, ?, ?, ?)",
            assistantId, "assistant", text, assistantNow
          );
        }
      });
    }

    // GET /emails — list all emails
    if (url.pathname === "/emails" && request.method === "GET") {
      const emails = [...sql.exec("SELECT * FROM email ORDER BY created_at DESC")];
      return Response.json({ emails });
    }

    // POST /emails — insert an inbound email
    if (url.pathname === "/emails" && request.method === "POST") {
      const body = await request.json<{
        subject: string;
        body: string;
        from_addr: string;
        to_addr: string;
      }>();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      sql.exec(
        "INSERT INTO email (id, subject, body, from_addr, to_addr, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        id, body.subject, body.body, body.from_addr, body.to_addr, now
      );
      return Response.json({ id });
    }

    return new Response("Not found", { status: 404 });
  }
}
