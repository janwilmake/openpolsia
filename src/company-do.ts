import { DurableObject } from "cloudflare:workers";
import type { Env } from "./worker";
import { runOperator, executeOperatorTask, type OperatorContext } from "./llm-operator";

export class CompanyDO extends DurableObject<Env> {
  private initialized = false;

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
          description: `Research ${body.userName || "the founder"} (${body.userEmail || "unknown email"}) online. Based on their background, interests, and expertise, come up with a unique business concept that fits them. Update the company name if appropriate. This is a surprise — be creative and make it personal.`,
        });
      } else if (body.method === "website") {
        tasks.push({
          title: `Research ${body.sourceInput} and create a similar business`,
          description: `Fetch and analyze the website at ${body.sourceInput}. Understand what the business does, its value proposition, branding, and target audience. Create a business concept inspired by it, using the same name (${body.companyName}). Capture key findings for use in subsequent tasks.`,
        });
      } else {
        tasks.push({
          title: "Develop the business idea",
          description: `The founder described their idea as: "${body.sourceInput || ""}". Flesh out this concept into a clear business plan. Define the target audience, core offering, and unique value proposition.`,
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
        description: `Create a document titled "website/index.html" containing a complete, styled HTML landing page for the company. It should include: a hero section with the company name and tagline, a description of what the company does, key features/benefits, and a call to action. Make it look professional with inline CSS. This page will be served at ${body.companySlug}.openpolsia.com.`,
      });

      tasks.push({
        title: "Send a welcome email to the founder",
        description: `Send a welcome email to ${body.userEmail || "the founder"} introducing the company, summarizing what has been set up (mission, market research, landing page), and outlining next steps. Use a warm, professional tone. Send from ${body.companySlug}@openpolsia.com.`,
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

    // GET /chat — list all chat messages (exclude tool_call/tool_result)
    if (url.pathname === "/chat" && request.method === "GET") {
      const messages = [...sql.exec("SELECT * FROM chat_message WHERE type = 'message' ORDER BY created_at ASC")];
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

    const companySlug = (await this.ctx.storage.get("companySlug")) as string || "unknown";
    const companyName = (await this.ctx.storage.get("companyName")) as string || "Unknown Company";
    const userEmail = (await this.ctx.storage.get("userEmail")) as string || undefined;
    const userName = (await this.ctx.storage.get("userName")) as string || undefined;

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
    } catch (e) {
      sql.exec("UPDATE task SET status = 'failed' WHERE id = ?", task.id);
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
