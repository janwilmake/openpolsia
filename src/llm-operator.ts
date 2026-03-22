import { streamText, tool, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { Bash } from "just-bash";
import { z } from "zod/v4";

export interface OperatorContext {
  sql: any;
  companySlug: string;
  resendApiKey: string;
  companyName: string;
  anthropicApiKey: string;
  parallelApiKey?: string;
  userEmail?: string;
  userName?: string;
}

function buildSystemPrompt(ctx: OperatorContext): string {
  const sql = ctx.sql;

  const docs = [
    ...sql.exec("SELECT id, title, content FROM document ORDER BY title ASC")
  ];
  const tasks = [
    ...sql.exec(
      "SELECT id, title, status, assigned_to, description FROM task ORDER BY created_at DESC"
    )
  ];
  const emails = [
    ...sql.exec(
      "SELECT id, subject, from_addr, to_addr, created_at FROM email ORDER BY created_at DESC LIMIT 20"
    )
  ];

  const fileTree =
    docs.map((d: any) => `  ${d.title} (${d.id})`).join("\n") || "  (empty)";
  const taskList =
    tasks
      .map(
        (t: any) =>
          `  [${t.status}] ${t.title} (${t.id}) — ${t.assigned_to || "unassigned"}`
      )
      .join("\n") || "  (empty)";
  const emailList =
    emails
      .map(
        (e: any) => `  ${e.subject} — ${e.from_addr} → ${e.to_addr} (${e.id})`
      )
      .join("\n") || "  (empty)";

  return `You are the AI operator for "${ctx.companyName}" on Open Polsia.
You manage this company's documents, tasks, emails, and operations.
Your email address is ${ctx.companySlug}@openpolsia.com.

Current state:

Documents:
${fileTree}

Tasks:
${taskList}

Recent Emails:
${emailList}

The user's name is ${ctx.userName || "unknown"} and their Google email is ${ctx.userEmail || "unknown"}.

Use the available tools to fulfill the user's requests. Be concise and action-oriented.
When creating documents, use descriptive titles.
When sending emails, always use ${ctx.companySlug}@openpolsia.com as the from address.`;
}

function createTools(ctx: OperatorContext) {
  const sql = ctx.sql;

  let bashInstance: Bash | null = null;
  async function getBash(): Promise<Bash> {
    if (bashInstance) return bashInstance;
    const docs = [...sql.exec("SELECT title, content FROM document")];
    const files: Record<string, string> = {};
    for (const d of docs as any[]) {
      const safeName = d.title.replace(/[^a-zA-Z0-9._-]/g, "_");
      files[`/docs/${safeName}`] = d.content;
    }
    bashInstance = new Bash({ files });
    return bashInstance;
  }

  return {
    readFile: tool({
      description: "Read a document by its ID",
      inputSchema: z.object({
        id: z.string().describe("The document ID to read")
      }),
      execute: async ({ id }) => {
        const doc = sql.exec("SELECT * FROM document WHERE id = ?", id).one();
        if (!doc) return { error: "Document not found" };
        return doc;
      }
    }),

    writeFile: tool({
      description:
        "Create or update a document. If id is provided, updates existing. Otherwise creates new.",
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe("Document ID to update (omit to create new)"),
        title: z.string().describe("Document title"),
        content: z.string().describe("Document content")
      }),
      execute: async ({ id, title, content }) => {
        if (id) {
          const existing = sql
            .exec("SELECT * FROM document WHERE id = ?", id)
            .one();
          if (!existing) return { error: "Document not found" };
          sql.exec(
            "UPDATE document SET title = ?, content = ? WHERE id = ?",
            title,
            content,
            id
          );
          return { id, title, updated: true };
        }
        const newId = crypto.randomUUID();
        const now = new Date().toISOString();
        sql.exec(
          "INSERT INTO document (id, title, content, created_at) VALUES (?, ?, ?, ?)",
          newId,
          title,
          content,
          now
        );
        return { id: newId, title, created: true };
      }
    }),

    justBash: tool({
      description:
        "Run a bash command in a sandboxed environment. The /docs directory contains all company documents as files. Useful for text processing, data manipulation, and scripting.",
      inputSchema: z.object({
        command: z.string().describe("The bash command to execute")
      }),
      execute: async ({ command }) => {
        const bash = await getBash();
        const result = await bash.exec(command);
        return {
          stdout: result.stdout.slice(0, 4000),
          stderr: result.stderr.slice(0, 1000),
          exitCode: result.exitCode
        };
      }
    }),

    listTasks: tool({
      description: "List all tasks, optionally filtered by status",
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe(
            "Filter by status: todo, in_progress, completed, recurring, rejected, failed"
          )
      }),
      execute: async ({ status }) => {
        if (status) {
          return {
            tasks: [
              ...sql.exec(
                "SELECT * FROM task WHERE status = ? ORDER BY created_at DESC",
                status
              )
            ]
          };
        }
        return {
          tasks: [...sql.exec("SELECT * FROM task ORDER BY created_at DESC")]
        };
      }
    }),

    createTask: tool({
      description: "Create a new task",
      inputSchema: z.object({
        title: z.string().describe("Task title"),
        description: z.string().default("").describe("Task description"),
        status: z.string().default("todo").describe("Task status"),
        assigned_to: z
          .string()
          .optional()
          .describe("Who the task is assigned to")
      }),
      execute: async ({ title, description, status, assigned_to }) => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        sql.exec(
          "INSERT INTO task (id, title, description, status, assigned_to, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          id,
          title,
          description,
          status,
          assigned_to || null,
          now
        );
        return { id, title, status, created: true };
      }
    }),

    editTask: tool({
      description:
        "Update an existing task's status, title, description, or assignment",
      inputSchema: z.object({
        id: z.string().describe("Task ID to update"),
        title: z.string().optional().describe("New title"),
        description: z.string().optional().describe("New description"),
        status: z.string().optional().describe("New status"),
        assigned_to: z.string().optional().describe("New assignee")
      }),
      execute: async ({ id, title, description, status, assigned_to }) => {
        const existing = sql.exec("SELECT * FROM task WHERE id = ?", id).one();
        if (!existing) return { error: "Task not found" };
        sql.exec(
          "UPDATE task SET title = ?, description = ?, status = ?, assigned_to = ? WHERE id = ?",
          title ?? existing.title,
          description ?? existing.description,
          status ?? existing.status,
          assigned_to ?? existing.assigned_to,
          id
        );
        return { id, updated: true };
      }
    }),

    sendMail: tool({
      description: "Send an email from the company's email address",
      inputSchema: z.object({
        to: z.string().describe("Recipient email address"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email body (plain text)")
      }),
      execute: async ({ to, subject, body }) => {
        const fromAddr = `${ctx.companySlug}@openpolsia.com`;

        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ctx.resendApiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: `${ctx.companyName} <${fromAddr}>`,
            to: [to],
            subject,
            text: body
          })
        });

        if (!resendRes.ok) {
          const err = await resendRes.text();
          return { error: "Failed to send email", details: err };
        }

        const emailId = crypto.randomUUID();
        const now = new Date().toISOString();
        sql.exec(
          "INSERT INTO email (id, subject, body, from_addr, to_addr, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          emailId,
          subject,
          body,
          fromAddr,
          to,
          now
        );

        const resendData = (await resendRes.json()) as any;
        return { sent: true, resend_id: resendData.id, email_id: emailId };
      }
    }),

    readMail: tool({
      description: "Read a specific email by ID",
      inputSchema: z.object({
        id: z.string().describe("Email ID to read")
      }),
      execute: async ({ id }) => {
        const email = sql.exec("SELECT * FROM email WHERE id = ?", id).one();
        if (!email) return { error: "Email not found" };
        return email;
      }
    }),

    listMail: tool({
      description: "List emails, optionally filtered",
      inputSchema: z.object({
        limit: z.number().default(20).describe("Max emails to return")
      }),
      execute: async ({ limit }) => {
        return {
          emails: [
            ...sql.exec(
              "SELECT * FROM email ORDER BY created_at DESC LIMIT ?",
              limit
            )
          ]
        };
      }
    }),

    sendMessage: tool({
      description:
        "Log an internal message to the company chat (visible in the chat history)",
      inputSchema: z.object({
        content: z.string().describe("Message content")
      }),
      execute: async ({ content }) => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        sql.exec(
          "INSERT INTO chat_message (id, role, content, created_at) VALUES (?, ?, ?, ?)",
          id,
          "assistant",
          content,
          now
        );
        return { id, sent: true };
      }
    }),

    webSearch: tool({
      description:
        "Search the web using Parallel API. Returns search results with titles, URLs, and excerpts.",
      inputSchema: z.object({
        objective: z
          .string()
          .describe("What you're searching for (natural language)"),
        max_results: z.number().default(5).describe("Maximum number of results")
      }),
      execute: async ({ objective, max_results }) => {
        if (!ctx.parallelApiKey) {
          return { error: "PARALLEL_API_KEY not configured" };
        }
        const res = await fetch("https://api.parallel.ai/v1beta/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ctx.parallelApiKey
          },
          body: JSON.stringify({ objective, max_results })
        });
        if (!res.ok) {
          return {
            error: "Search failed",
            status: res.status,
            details: await res.text()
          };
        }
        return await res.json();
      }
    }),

    webFetch: tool({
      description: "Fetch and extract content from a URL using Parallel API.",
      inputSchema: z.object({
        url: z.string().describe("URL to fetch content from"),
        objective: z
          .string()
          .optional()
          .describe("Focus extraction on this objective")
      }),
      execute: async ({ url, objective }) => {
        if (!ctx.parallelApiKey) {
          return { error: "PARALLEL_API_KEY not configured" };
        }
        const res = await fetch("https://api.parallel.ai/v1beta/extract", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ctx.parallelApiKey
          },
          body: JSON.stringify({
            urls: [url],
            objective,
            excerpts: true,
            full_content: true
          })
        });
        if (!res.ok) {
          return {
            error: "Fetch failed",
            status: res.status,
            details: await res.text()
          };
        }
        return await res.json();
      }
    })
  };
}

export function runOperator(
  ctx: OperatorContext,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  onFinish?: (text: string) => void
): Response {
  const anthropic = createAnthropic({ apiKey: ctx.anthropicApiKey });
  const systemPrompt = buildSystemPrompt(ctx);
  const tools = createTools(ctx);
  const sql = ctx.sql;

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: systemPrompt,
    messages,
    tools,
    stopWhen: stepCountIs(10),
    onFinish: (event) => {
      // Save all tool calls and results from all steps
      for (const step of event.steps) {
        if (step.toolCalls) {
          for (const tc of step.toolCalls) {
            sql.exec(
              "INSERT INTO chat_message (id, role, type, content, created_at) VALUES (?, ?, ?, ?, ?)",
              crypto.randomUUID(),
              "assistant",
              "tool_call",
              JSON.stringify({ tool: tc.toolName, input: tc.input }),
              new Date().toISOString()
            );
          }
        }
        if (step.toolResults) {
          for (const tr of step.toolResults as any[]) {
            sql.exec(
              "INSERT INTO chat_message (id, role, type, content, created_at) VALUES (?, ?, ?, ?, ?)",
              crypto.randomUUID(),
              "assistant",
              "tool_result",
              JSON.stringify({ tool: tr.toolName, result: tr.result }),
              new Date().toISOString()
            );
          }
        }
      }
      if (onFinish && event.text) {
        onFinish(event.text);
      }
    }
  });

  return result.toTextStreamResponse();
}
