import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types";
import { runOperator, executeOperatorTask, type OperatorContext } from "./llm-operator";

export class CompanyDO extends DurableObject<Env> {
  private initialized = false;
  private sseWriters = new Set<WritableStreamDefaultWriter>();

  private notifySSE(event: string, data?: any) {
    const payload = data ? JSON.stringify(data) : "{}";
    const msg = `event: ${event}\ndata: ${payload}\n\n`;
    const encoded = new TextEncoder().encode(msg);
    for (const writer of this.sseWriters) {
      writer.write(encoded).catch(() => {
        this.sseWriters.delete(writer);
      });
    }
  }

  private async ensureInit() {
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
      ["task", "recurrence", "TEXT"],
      ["task", "next_run_at", "TEXT"],
      ["chat_message", "type", "TEXT NOT NULL DEFAULT 'message'"],
      ["chat_message", "task_id", "TEXT"],
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

    // Recover from interrupted deploys: reset stuck in_progress tasks and reschedule alarm
    sql.exec("UPDATE task SET status = 'todo' WHERE status = 'in_progress'");
    sql.exec("UPDATE chat_message SET type = 'message' WHERE type = 'streaming'");

    const pending = [...sql.exec(
      "SELECT id FROM task WHERE status = 'todo' AND (next_run_at IS NULL OR next_run_at <= ?) LIMIT 1",
      new Date().toISOString()
    )][0];
    if (pending) {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    } else {
      const future = [...sql.exec(
        "SELECT next_run_at FROM task WHERE status = 'todo' AND next_run_at > ? ORDER BY next_run_at ASC LIMIT 1",
        new Date().toISOString()
      )][0] as any;
      if (future) {
        await this.ctx.storage.setAlarm(new Date(future.next_run_at).getTime());
      }
    }

    this.initialized = true;
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureInit();
    const url = new URL(request.url);
    const sql = this.ctx.storage.sql;

    // DELETE /destroy — wipe all DO data
    if (url.pathname === "/destroy" && request.method === "DELETE") {
      sql.exec("DELETE FROM document");
      sql.exec("DELETE FROM task");
      sql.exec("DELETE FROM chat_message");
      sql.exec("DELETE FROM email");
      await this.ctx.storage.deleteAll();
      return Response.json({ ok: true });
    }

    // POST /init — create initial tasks based on company creation method
    if (url.pathname === "/init" && request.method === "POST") {
      const body = await request.json<{
        method: string;
        sourceInput?: string;
        companyId: string;
        companyName: string;
        companySlug: string;
        userEmail?: string;
        userName?: string;
      }>();

      const now = new Date().toISOString();
      const tasks: { title: string; description: string }[] = [];

      if (body.method === "surprise") {
        tasks.push({
          title: "Research the founder and design a fitting business",
          description: `Research ${body.userName || "the founder"} (${body.userEmail || "unknown email"}) online. Based on their background, interests, and expertise, come up with a unique business concept that fits them. This is a surprise — be creative and make it personal. Once you have the concept, use the updateCompany tool to set a fitting company name, a short clean slug (lowercase, underscores, max 15 chars), and a one-line description.`,
        });
      } else if (body.method === "website") {
        tasks.push({
          title: `Research ${body.sourceInput} and create a similar business`,
          description: `Fetch and analyze the website at ${body.sourceInput}. Understand what the business does, its value proposition, branding, and target audience. Create a business concept inspired by it. Capture key findings for use in subsequent tasks. Use the updateCompany tool to set an appropriate company name, a short clean slug (lowercase, underscores, max 15 chars), and a one-line description.`,
        });
      } else {
        tasks.push({
          title: "Develop the business idea",
          description: `The founder described their idea as: "${body.sourceInput || ""}". Flesh out this concept into a clear business plan. Define the target audience, core offering, and unique value proposition. Use the updateCompany tool to set a fitting company name, a short clean slug (lowercase, underscores, max 15 chars), and a one-line description.`,
        });
      }

      tasks.push({
        title: "Write the company mission document",
        description: `Create a document titled "Mission" that defines the company's mission, vision, and core values. Base it on the business concept established in the previous task. Keep it concise, inspiring, and actionable.`,
      });

      tasks.push({
        title: "Conduct market research",
        description: `Research the market for this business. Identify competitors, target demographics, market size, trends, and opportunities. Create a document titled "Market Research" with your findings.`,
      });

      tasks.push({
        title: "Build the company landing page",
        description: `Create a document titled "website/index.html" containing a complete, styled HTML landing page for the company. It should include: a hero section with the company name and tagline, a description of what the company does, key features/benefits, and a call to action. Make it look professional with inline CSS. This page will be served at the company's subdomain (check the system prompt for the current slug).`,
      });

      tasks.push({
        title: "Send a welcome email to the founder",
        description: `Send a welcome email to ${body.userEmail || "the founder"} introducing the company, summarizing what has been set up (mission, market research, landing page), and outlining next steps. Use a warm, professional tone. Send from the company's email address (check the system prompt for the current slug).`,
      });

      for (const t of tasks) {
        sql.exec(
          "INSERT INTO task (id, title, description, status, assigned_to, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          crypto.randomUUID(),
          t.title,
          t.description,
          "todo",
          "operator",
          now
        );
      }

      // Persist company metadata so the alarm handler can build OperatorContext
      await this.ctx.storage.put("companyId", body.companyId);
      await this.ctx.storage.put("companySlug", body.companySlug);
      await this.ctx.storage.put("companyName", body.companyName);
      await this.ctx.storage.put("userEmail", body.userEmail || "");
      await this.ctx.storage.put("userName", body.userName || "");

      // Schedule the first task execution
      await this.ctx.storage.setAlarm(Date.now() + 1000);

      return Response.json({ ok: true, tasks_created: tasks.length });
    }

    if (url.pathname === "/data" && request.method === "GET") {
      const documents = [...sql.exec("SELECT * FROM document ORDER BY created_at DESC")];
      const tasks = [...sql.exec("SELECT * FROM task ORDER BY created_at DESC")];
      const chat = [...sql.exec("SELECT * FROM chat_message WHERE type = 'message' ORDER BY created_at ASC")];
      const emails = [...sql.exec("SELECT * FROM email ORDER BY created_at DESC")];
      const logs = [...sql.exec("SELECT * FROM chat_message WHERE type IN ('tool_call', 'tool_result') ORDER BY created_at DESC")];
      return Response.json({ documents, tasks, chat, emails, logs });
    }

    // GET /sse — Server-Sent Events stream
    if (url.pathname === "/sse" && request.method === "GET") {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      this.sseWriters.add(writer);

      // Send initial ping
      writer.write(new TextEncoder().encode("event: connected\ndata: {}\n\n")).catch(() => {});

      // Clean up on close
      request.signal.addEventListener("abort", () => {
        this.sseWriters.delete(writer);
        writer.close().catch(() => {});
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // GET /documents — list all documents
    if (url.pathname === "/documents" && request.method === "GET") {
      const documents = [...sql.exec("SELECT * FROM document ORDER BY created_at DESC")];
      return Response.json({ documents });
    }

    // GET /documents-by-title/:title — look up document by title
    const docByTitleMatch = url.pathname.match(/^\/documents-by-title\/(.+)$/);
    if (docByTitleMatch && request.method === "GET") {
      const title = decodeURIComponent(docByTitleMatch[1]);
      const doc = [...sql.exec("SELECT * FROM document WHERE title = ?", title)][0];
      if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json(doc);
    }

    // GET /documents/:id — single document
    const docGetMatch = url.pathname.match(/^\/documents\/(.+)$/);
    if (docGetMatch && request.method === "GET") {
      const doc = [...sql.exec("SELECT * FROM document WHERE id = ?", docGetMatch[1])][0];
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

    // GET /tasks/:id/messages — get all chat messages for a task
    const taskMsgsMatch = url.pathname.match(/^\/tasks\/([^/]+)\/messages$/);
    if (taskMsgsMatch && request.method === "GET") {
      const taskId = taskMsgsMatch[1];
      const messages = [...sql.exec(
        "SELECT * FROM chat_message WHERE task_id = ? ORDER BY created_at ASC",
        taskId
      )];
      return Response.json({ messages });
    }

    // POST /tasks/:id/retry — retry a failed task
    const taskRetryMatch = url.pathname.match(/^\/tasks\/([^/]+)\/retry$/);
    if (taskRetryMatch && request.method === "POST") {
      const taskId = taskRetryMatch[1];
      const task = sql.exec("SELECT * FROM task WHERE id = ?", taskId).one() as any;
      if (!task) return Response.json({ error: "Task not found" }, { status: 404 });
      if (task.status !== "failed") return Response.json({ error: "Only failed tasks can be retried" }, { status: 400 });

      sql.exec("UPDATE task SET status = 'todo', next_run_at = NULL WHERE id = ?", taskId);
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      return Response.json({ ok: true });
    }

    // GET /chat — list all chat messages including tool calls/results
    if (url.pathname === "/chat" && request.method === "GET") {
      const messages = [...sql.exec("SELECT * FROM chat_message WHERE type IN ('message', 'tool_call', 'tool_result') ORDER BY created_at ASC")];
      return Response.json({ messages });
    }

    // GET /chat/streaming — get the currently streaming message (if any)
    if (url.pathname === "/chat/streaming" && request.method === "GET") {
      const streaming = [...sql.exec(
        "SELECT * FROM chat_message WHERE type = 'streaming' ORDER BY created_at DESC LIMIT 1"
      )][0];
      if (streaming) {
        return Response.json({ message: streaming });
      }
      return Response.json({ message: null });
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
      // Block chat for companies over the subscription limit
      if (request.headers.get("x-company-over-limit") === "1") {
        return Response.json(
          { error: "This company exceeds your subscription limit. Upgrade your plan to enable chat for more companies." },
          { status: 403 }
        );
      }

      const body = await request.json<{ content: string }>();
      const companySlug = request.headers.get("x-company-slug") || "unknown";
      const companyName = request.headers.get("x-company-name") || "Unknown Company";
      const userEmail = request.headers.get("x-user-email") || undefined;
      const userName = request.headers.get("x-user-name") || undefined;

      // /clear command: wipe chat history (not task messages) and return
      if (body.content.trim().toLowerCase() === "/clear") {
        sql.exec("DELETE FROM chat_message WHERE task_id IS NULL");
        this.notifySSE("update", { type: "chat" });
        return new Response("Chat history cleared.", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      // Save user message
      const msgId = crypto.randomUUID();
      const now = new Date().toISOString();
      sql.exec(
        "INSERT INTO chat_message (id, role, content, created_at) VALUES (?, ?, ?, ?)",
        msgId, "user", body.content, now
      );

      // Build message history from last 20 messages for context
      // Filter out task execution messages (they have task_id set) to avoid
      // consecutive assistant messages which break Anthropic's alternating role requirement
      const rawHistory = [...sql.exec(
        "SELECT role, content FROM chat_message WHERE type = 'message' AND task_id IS NULL ORDER BY created_at ASC"
      )].slice(-20).map((m: any) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content as string,
      }));

      // Merge consecutive same-role messages as a safety net
      const history: Array<{ role: "user" | "assistant"; content: string }> = [];
      for (const msg of rawHistory) {
        if (history.length > 0 && history[history.length - 1].role === msg.role) {
          history[history.length - 1].content += "\n\n" + msg.content;
        } else {
          history.push({ ...msg });
        }
      }

      const companyId = request.headers.get("x-company-id")
        || (await this.ctx.storage.get("companyId")) as string
        || "unknown";
      const companyUserId = request.headers.get("x-company-user-id") || "";

      const billingRow = companyUserId ? await this.env.DB.prepare(
        `SELECT task_credits, tasks_used, subscription_status FROM user_billing WHERE user_id = ?`
      ).bind(companyUserId).first<{ task_credits: number; tasks_used: number; subscription_status: string }>() : null;

      const subscriptionActive = billingRow?.subscription_status === "active";
      const taskCreditsRemaining = (billingRow?.task_credits ?? 50) - (billingRow?.tasks_used ?? 0);

      const chatStorage = this.ctx.storage;
      const opCtx: OperatorContext = {
        sql,
        db: this.env.DB,
        companyId,
        companySlug,
        companyName,
        resendApiKey: this.env.RESEND_API_KEY,
        anthropicApiKey: this.env.ANTHROPIC_API_KEY,
        parallelApiKey: this.env.PARALLEL_API_KEY,
        userEmail,
        userName,
        subscriptionActive,
        taskCreditsRemaining,
        onMetadataUpdate: async (updates) => {
          if (updates.slug) await chatStorage.put("companySlug", updates.slug);
          if (updates.name) await chatStorage.put("companyName", updates.name);
        },
        onDataChange: (type) => this.notifySSE("update", { type }),
      };

      // Create a streaming placeholder message
      const streamMsgId = crypto.randomUUID();
      sql.exec(
        "INSERT INTO chat_message (id, role, type, content, created_at) VALUES (?, ?, ?, ?, ?)",
        streamMsgId, "assistant", "streaming", "", new Date().toISOString()
      );

      return runOperator(opCtx, history, streamMsgId);
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

  private getRecurrenceMs(recurrence: string | null): number | null {
    switch (recurrence) {
      case "hourly": return 60 * 60 * 1000;
      case "daily": return 24 * 60 * 60 * 1000;
      case "weekly": return 7 * 24 * 60 * 60 * 1000;
      default: return null;
    }
  }

  async alarm() {
    await this.ensureInit();
    const sql = this.ctx.storage.sql;
    const now = new Date().toISOString();

    // Pick the next due task: todo and either no next_run_at or next_run_at <= now
    const task = [...sql.exec(
      "SELECT * FROM task WHERE status = 'todo' AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY created_at ASC LIMIT 1",
      now
    )][0] as any;

    if (!task) {
      // No immediately runnable task — check if there's a future recurring task to wait for
      const futureTask = [...sql.exec(
        "SELECT next_run_at FROM task WHERE status = 'todo' AND next_run_at > ? ORDER BY next_run_at ASC LIMIT 1",
        now
      )][0] as any;

      if (futureTask) {
        const nextTime = new Date(futureTask.next_run_at).getTime();
        await this.ctx.storage.setAlarm(nextTime);
      }
      return;
    }

    // Mark as in_progress
    sql.exec("UPDATE task SET status = 'in_progress' WHERE id = ?", task.id);
    this.notifySSE("update", { type: "task" });

    const companyId = (await this.ctx.storage.get("companyId")) as string || "unknown";
    const companySlug = (await this.ctx.storage.get("companySlug")) as string || "unknown";
    const companyName = (await this.ctx.storage.get("companyName")) as string || "Unknown Company";
    const userEmail = (await this.ctx.storage.get("userEmail")) as string || undefined;
    const userName = (await this.ctx.storage.get("userName")) as string || undefined;

    // Fetch billing status
    const companyRow = await this.env.DB.prepare(
      `SELECT user_id FROM company WHERE id = ?`
    ).bind(companyId).first<{ user_id: string }>();

    const billingRow = companyRow ? await this.env.DB.prepare(
      `SELECT task_credits, tasks_used, subscription_status FROM user_billing WHERE user_id = ?`
    ).bind(companyRow.user_id).first<{ task_credits: number; tasks_used: number; subscription_status: string }>() : null;

    const subscriptionActive = billingRow?.subscription_status === "active";
    const taskCreditsRemaining = (billingRow?.task_credits ?? 50) - (billingRow?.tasks_used ?? 0);

    // Skip task if no subscription and no free credits remaining
    if (!subscriptionActive && taskCreditsRemaining <= 0) {
      sql.exec("UPDATE task SET status = 'todo' WHERE id = ?", task.id);
      return;
    }

    const storage = this.ctx.storage;
    const ownerUserId = companyRow?.user_id;
    const opCtx: OperatorContext = {
      sql,
      db: this.env.DB,
      companyId,
      companySlug,
      companyName,
      resendApiKey: this.env.RESEND_API_KEY,
      anthropicApiKey: this.env.ANTHROPIC_API_KEY,
      parallelApiKey: this.env.PARALLEL_API_KEY,
      userEmail,
      userName,
      subscriptionActive: subscriptionActive || taskCreditsRemaining > 0,
      taskCreditsRemaining,
      onMetadataUpdate: async (updates) => {
        if (updates.slug) await storage.put("companySlug", updates.slug);
        if (updates.name) await storage.put("companyName", updates.name);
      },
      onDataChange: (type) => this.notifySSE("update", { type }),
      onTaskCreditUsed: ownerUserId ? async () => {
        await this.env.DB.prepare(
          `UPDATE user_billing SET tasks_used = tasks_used + 1 WHERE user_id = ?`
        ).bind(ownerUserId).run();
      } : undefined,
    };

    try {
      await executeOperatorTask(opCtx, task.id, task.title, task.description);

      const intervalMs = this.getRecurrenceMs(task.recurrence);
      if (intervalMs) {
        // Recurring: reset to todo with next_run_at
        const nextRun = new Date(Date.now() + intervalMs).toISOString();
        sql.exec(
          "UPDATE task SET status = 'todo', next_run_at = ? WHERE id = ?",
          nextRun, task.id
        );
      } else {
        sql.exec("UPDATE task SET status = 'completed' WHERE id = ?", task.id);
      }
      this.notifySSE("update", { type: "task" });
    } catch (e) {
      sql.exec("UPDATE task SET status = 'failed' WHERE id = ?", task.id);
      this.notifySSE("update", { type: "task" });
    }

    // Schedule next alarm: check for immediate tasks first, then future ones
    const immediate = [...sql.exec(
      "SELECT id FROM task WHERE status = 'todo' AND (next_run_at IS NULL OR next_run_at <= ?) LIMIT 1",
      new Date().toISOString()
    )][0];

    if (immediate) {
      await this.ctx.storage.setAlarm(Date.now() + 2000);
      return;
    }

    const futureTask = [...sql.exec(
      "SELECT next_run_at FROM task WHERE status = 'todo' AND next_run_at > ? ORDER BY next_run_at ASC LIMIT 1",
      new Date().toISOString()
    )][0] as any;

    if (futureTask) {
      const nextTime = new Date(futureTask.next_run_at).getTime();
      await this.ctx.storage.setAlarm(nextTime);
    }
  }
}
