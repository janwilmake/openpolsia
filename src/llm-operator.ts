import { streamText, generateText, tool, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { Bash } from "just-bash";
import { z } from "zod/v4";

export interface OperatorContext {
  sql: any;
  db: D1Database;
  companyId: string;
  companySlug: string;
  resendApiKey: string;
  companyName: string;
  anthropicApiKey: string;
  parallelApiKey?: string;
  userEmail?: string;
  userName?: string;
  /** Whether the user has an active subscription */
  subscriptionActive?: boolean;
  /** Remaining task credits (free + purchased) */
  taskCreditsRemaining?: number;
  /** Called when company metadata changes so the DO can update its stored values */
  onMetadataUpdate?: (updates: { slug?: string; name?: string }) => Promise<void>;
  /** Called when data changes so the DO can notify SSE clients */
  onDataChange?: (type: string) => void;
  /** Called to decrement task credits after task execution */
  onTaskCreditUsed?: () => Promise<void>;
}

function buildSystemPrompt(ctx: OperatorContext): string {
  const sql = ctx.sql;

  const docs = [
    ...sql.exec("SELECT id, title, content FROM document ORDER BY title ASC")
  ];
  const tasks = [
    ...sql.exec(
      "SELECT id, title, status, assigned_to, description, recurrence, next_run_at FROM task ORDER BY created_at DESC"
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
          `  [${t.status}] ${t.title} (${t.id}) — ${t.assigned_to || "unassigned"}${t.recurrence ? ` (${t.recurrence})` : ""}`
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
When sending emails, always use ${ctx.companySlug}@openpolsia.com as the from address.
You can update the company's name, slug, and description using the updateCompany tool. The slug determines the subdomain (slug.openpolsia.com) and email address (slug@openpolsia.com).${
    ctx.subscriptionActive
      ? `\n\nTask credits remaining: ${ctx.taskCreditsRemaining ?? 0}. Each task execution costs 1 credit.`
      : `\n\nIMPORTANT: This user does not have an active subscription. Do NOT execute any tools or actions. Instead, politely inform them that they need to purchase a subscription ($49/mo per company, includes a 3-day free trial) before you can take any actions. Direct them to click the "Start free trial" button on the dashboard.`
  }`;
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
          ctx.onDataChange?.("document");
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
        ctx.onDataChange?.("document");
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
      description: "Create a new task. Set recurrence for recurring tasks.",
      inputSchema: z.object({
        title: z.string().describe("Task title"),
        description: z.string().default("").describe("Task description"),
        status: z.string().default("todo").describe("Task status"),
        assigned_to: z
          .string()
          .optional()
          .describe("Who the task is assigned to"),
        recurrence: z
          .enum(["hourly", "daily", "weekly"])
          .optional()
          .describe("Recurrence interval. Omit for one-off tasks.")
      }),
      execute: async ({ title, description, status, assigned_to, recurrence }) => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        sql.exec(
          "INSERT INTO task (id, title, description, status, assigned_to, recurrence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          id,
          title,
          description,
          status,
          assigned_to || null,
          recurrence || null,
          now
        );
        ctx.onDataChange?.("task");
        return { id, title, status, recurrence: recurrence || null, created: true };
      }
    }),

    editTask: tool({
      description:
        "Update an existing task's status, title, description, assignment, or recurrence",
      inputSchema: z.object({
        id: z.string().describe("Task ID to update"),
        title: z.string().optional().describe("New title"),
        description: z.string().optional().describe("New description"),
        status: z.string().optional().describe("New status"),
        assigned_to: z.string().optional().describe("New assignee"),
        recurrence: z
          .enum(["hourly", "daily", "weekly"])
          .nullable()
          .optional()
          .describe("Set recurrence interval, or null to make one-off")
      }),
      execute: async ({ id, title, description, status, assigned_to, recurrence }) => {
        const existing = sql.exec("SELECT * FROM task WHERE id = ?", id).one() as any;
        if (!existing) return { error: "Task not found" };
        sql.exec(
          "UPDATE task SET title = ?, description = ?, status = ?, assigned_to = ?, recurrence = ? WHERE id = ?",
          title ?? existing.title,
          description ?? existing.description,
          status ?? existing.status,
          assigned_to ?? existing.assigned_to,
          recurrence !== undefined ? recurrence : existing.recurrence,
          id
        );
        ctx.onDataChange?.("task");
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
        ctx.onDataChange?.("email");
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
        ctx.onDataChange?.("chat");
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
    }),

    updateCompany: tool({
      description:
        "Update the company's name, slug (URL handle), and/or description. " +
        "The slug must be unique across all companies (letters, numbers, underscores only, max 15 chars). " +
        "If the requested slug is already taken, the tool returns all existing slugs containing the requested slug so you can pick an alternative.",
      inputSchema: z.object({
        name: z.string().optional().describe("New company name"),
        slug: z
          .string()
          .optional()
          .describe(
            "New URL slug (letters, numbers, underscores only, max 15 chars). Must be unique."
          ),
        description: z
          .string()
          .optional()
          .describe("New company description")
      }),
      execute: async ({ name, slug, description }) => {
        if (!name && !slug && !description) {
          return { error: "At least one of name, slug, or description is required" };
        }

        // Validate and check slug uniqueness
        if (slug) {
          const sanitized = slug
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "")
            .slice(0, 15);
          if (sanitized !== slug) {
            return {
              error: "Invalid slug. Use only lowercase letters, numbers, and underscores (max 15 chars).",
              suggested: sanitized,
            };
          }

          const existing = await ctx.db
            .prepare(`SELECT slug FROM "company" WHERE slug = ? AND id != ?`)
            .bind(slug, ctx.companyId)
            .first();

          if (existing) {
            // Slug taken — return similar slugs so the AI can choose
            const { results: similar } = await ctx.db
              .prepare(
                `SELECT slug FROM "company" WHERE slug LIKE ? ORDER BY slug`
              )
              .bind(`%${slug}%`)
              .all();
            return {
              error: "Slug is already taken",
              requested: slug,
              existing_similar_slugs: similar.map((r: any) => r.slug),
            };
          }
        }

        // Apply updates to D1
        const updates: string[] = [];
        const values: any[] = [];
        if (name) {
          updates.push("name = ?");
          values.push(name);
        }
        if (slug) {
          updates.push("slug = ?");
          values.push(slug);
        }
        if (description) {
          updates.push("description = ?");
          values.push(description);
        }
        values.push(ctx.companyId);

        await ctx.db
          .prepare(`UPDATE "company" SET ${updates.join(", ")} WHERE id = ?`)
          .bind(...values)
          .run();

        // Update DO-stored metadata and context
        if (ctx.onMetadataUpdate) {
          await ctx.onMetadataUpdate({
            slug: slug || undefined,
            name: name || undefined,
          });
        }
        if (slug) ctx.companySlug = slug;
        if (name) ctx.companyName = name;
        ctx.onDataChange?.("company");

        return {
          updated: true,
          companyId: ctx.companyId,
          name: name || ctx.companyName,
          slug: slug || ctx.companySlug,
          description: description || undefined,
        };
      }
    }),
  };
}

export function runOperator(
  ctx: OperatorContext,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  streamMsgId: string,
): Response {
  const anthropic = createAnthropic({ apiKey: ctx.anthropicApiKey });
  const systemPrompt = buildSystemPrompt(ctx);
  const tools = ctx.subscriptionActive ? createTools(ctx) : {};
  const sql = ctx.sql;

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: systemPrompt,
    messages,
    tools,
    stopWhen: stepCountIs(10),
    onFinish: (event) => {
      // Save all tool calls and results with sequential timestamps
      // so they sort BEFORE the final text message
      const now = Date.now();
      let seq = 0;
      for (const step of event.steps) {
        if (step.toolCalls) {
          for (const tc of step.toolCalls) {
            sql.exec(
              "INSERT INTO chat_message (id, role, type, content, created_at) VALUES (?, ?, ?, ?, ?)",
              crypto.randomUUID(),
              "assistant",
              "tool_call",
              JSON.stringify({ tool: tc.toolName, input: tc.input }),
              new Date(now + seq).toISOString()
            );
            seq++;
          }
        }
        if (step.toolResults) {
          for (const tr of step.toolResults as any[]) {
            sql.exec(
              "INSERT INTO chat_message (id, role, type, content, created_at) VALUES (?, ?, ?, ?, ?)",
              crypto.randomUUID(),
              "assistant",
              "tool_result",
              JSON.stringify({ tool: tr.toolName, result: tr.output }),
              new Date(now + seq).toISOString()
            );
            seq++;
          }
        }
      }
      // Finalize the streaming message with timestamp after all tool events
      sql.exec(
        "UPDATE chat_message SET type = 'message', content = ?, created_at = ? WHERE id = ?",
        event.text || "",
        new Date(now + seq + 1).toISOString(),
        streamMsgId
      );
      // Notify SSE clients so chat updates without needing a refresh
      ctx.onDataChange?.("chat");
    }
  });

  // Create a custom stream that saves partial text to DB as it arrives
  // Sends NDJSON events: {"t":"d","v":"..."} for text, {"t":"c",...} for tool calls, {"t":"r",...} for results
  const encoder = new TextEncoder();
  let accumulated = "";
  let lastSaveLen = 0;
  let clientConnected = true;

  const stream = new ReadableStream({
    async start(controller) {
      function send(line: string) {
        if (!clientConnected) return;
        try {
          controller.enqueue(encoder.encode(line + "\n"));
        } catch {
          clientConnected = false;
        }
      }

      try {
        for await (const event of result.fullStream) {
          if (event.type === "text-delta") {
            accumulated += event.text;
            send(JSON.stringify({ t: "d", v: event.text }));

            // Save to DB every 200 chars
            if (accumulated.length - lastSaveLen >= 200) {
              sql.exec(
                "UPDATE chat_message SET content = ? WHERE id = ?",
                accumulated,
                streamMsgId
              );
              lastSaveLen = accumulated.length;
            }
          } else if (event.type === "tool-call") {
            send(JSON.stringify({ t: "c", tool: event.toolName, input: event.input }));
          } else if (event.type === "tool-result") {
            send(JSON.stringify({ t: "r", tool: event.toolName, result: event.output }));
          }
        }

        // Final partial save (onFinish handles the real finalization)
        if (accumulated.length > lastSaveLen) {
          sql.exec(
            "UPDATE chat_message SET content = ? WHERE id = ?",
            accumulated,
            streamMsgId
          );
        }
      } catch (e) {
        // Save what we have on error
        if (accumulated.length > lastSaveLen) {
          sql.exec(
            "UPDATE chat_message SET content = ? WHERE id = ?",
            accumulated,
            streamMsgId
          );
        }
      } finally {
        if (clientConnected) {
          try {
            controller.close();
          } catch {}
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function executeOperatorTask(
  ctx: OperatorContext,
  taskId: string,
  taskTitle: string,
  taskDescription: string
): Promise<{ success: boolean; text: string }> {
  const anthropic = createAnthropic({ apiKey: ctx.anthropicApiKey });
  const systemPrompt = buildSystemPrompt(ctx);
  const tools = ctx.subscriptionActive ? createTools(ctx) : {};
  const sql = ctx.sql;

  // Decrement task credits when executing a task
  if (ctx.subscriptionActive && ctx.onTaskCreditUsed) {
    await ctx.onTaskCreditUsed();
  }

  const result = await generateText({
    model: anthropic("claude-sonnet-4-6"),
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Execute this task:\n\nTitle: ${taskTitle}\nDescription: ${taskDescription}\n\nUse the available tools to complete this task. Be thorough and action-oriented.`,
      },
    ],
    tools,
    stopWhen: stepCountIs(10),
  });

  // Save tool calls and results from all steps, tagged with task_id
  for (const step of result.steps) {
    if (step.toolCalls) {
      for (const tc of step.toolCalls) {
        sql.exec(
          "INSERT INTO chat_message (id, role, type, content, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          crypto.randomUUID(),
          "assistant",
          "tool_call",
          JSON.stringify({ tool: tc.toolName, input: tc.input }),
          taskId,
          new Date().toISOString()
        );
      }
    }
    if (step.toolResults) {
      for (const tr of step.toolResults as any[]) {
        sql.exec(
          "INSERT INTO chat_message (id, role, type, content, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          crypto.randomUUID(),
          "assistant",
          "tool_result",
          JSON.stringify({ tool: tr.toolName, result: tr.output }),
          taskId,
          new Date().toISOString()
        );
      }
    }
  }

  // Save the final assistant text as a chat message
  if (result.text.trim()) {
    sql.exec(
      "INSERT INTO chat_message (id, role, content, task_id, created_at) VALUES (?, ?, ?, ?, ?)",
      crypto.randomUUID(),
      "assistant",
      result.text,
      taskId,
      new Date().toISOString()
    );
  }

  return { success: true, text: result.text };
}
