import { createAuth } from "./auth";
import { type Env, type Company } from "./types";
import { dashboardHTML } from "./pages/dashboard";
import { documentsPageHTML } from "./pages/documents";
import { tasksPageHTML } from "./pages/tasks";
import { emailsPageHTML } from "./pages/emails";
import {
  createOrGetCustomer,
  createCheckoutSession,
  createTaskPurchaseSession,
  createPortalSession,
  updateSubscriptionQuantity,
  handleWebhook,
} from "./stripe";
import indexPageHTML from "../public/index.html";
import newPageHTML from "../public/new.html";
import aboutPageHTML from "../public/about.html";
import termsPageHTML from "../public/terms.html";
import privacyPageHTML from "../public/privacy.html";

export { CompanyDO } from "./company-do";
export type { Env } from "./types";

function generateId() {
  return crypto.randomUUID();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // --- Subdomain routing: serve website/* documents from the company's DO ---
    const hostname = url.hostname;
    const subdomainMatch =
      hostname.match(/^([a-z0-9_-]+)\.openpolsia\.com$/i) ||
      hostname.match(/^([a-z0-9_-]+)\.localhost\.localhost$/i);
    if (subdomainMatch && subdomainMatch[1] !== "www") {
      const subdomain = subdomainMatch[1].toLowerCase();

      // Look up company by slug
      const company = await env.DB.prepare(
        `SELECT * FROM "company" WHERE slug = ?`
      )
        .bind(subdomain)
        .first<Company>();

      if (!company) {
        return new Response("Company not found", { status: 404 });
      }

      const doId = env.COMPANY_DO.idFromName(company.id);
      const stub = env.COMPANY_DO.get(doId);

      // Determine which document to serve
      const docPath =
        url.pathname === "/" ? "website/index.html" : "website" + url.pathname;

      // Fetch the document from the DO (look up by title)
      const res = await stub.fetch(
        new Request(
          "https://do/documents-by-title/" + encodeURIComponent(docPath)
        )
      );

      if (res.ok) {
        const doc = (await res.json()) as {
          id: string;
          title: string;
          content: string;
        };
        // Guess content type from the path
        const contentType = docPath.endsWith(".html")
          ? "text/html;charset=utf-8"
          : docPath.endsWith(".css")
            ? "text/css;charset=utf-8"
            : docPath.endsWith(".js")
              ? "application/javascript;charset=utf-8"
              : docPath.endsWith(".json")
                ? "application/json;charset=utf-8"
                : "text/plain;charset=utf-8";
        return new Response(doc.content, {
          headers: { "Content-Type": contentType }
        });
      }

      // Document not found
      return new Response("Document not found", { status: 404 });
    }

    const auth = createAuth(env);

    // Handle all Better Auth routes (/api/auth/*)
    if (url.pathname.startsWith("/api/auth")) {
      return auth.handler(request);
    }

    // --- Stripe webhook (no auth, signature verified) ---
    if (url.pathname === "/api/webhooks/stripe" && request.method === "POST") {
      return handleWebhook(env, request);
    }

    // --- Billing API ---
    if (url.pathname.startsWith("/api/billing")) {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session)
        return Response.json({ error: "Unauthorized" }, { status: 401 });

      const returnUrl = url.origin + "/dashboard";

      if (url.pathname === "/api/billing/checkout" && request.method === "POST") {
        const body = await request.json<{ quantity?: number }>();
        const quantity = body.quantity || 1;
        const customerId = await createOrGetCustomer(env, session.user.id, session.user.email);
        const checkoutUrl = await createCheckoutSession(env, customerId, quantity, returnUrl);
        return Response.json({ url: checkoutUrl });
      }

      if (url.pathname === "/api/billing/buy-tasks" && request.method === "POST") {
        const body = await request.json<{ quantity?: number }>();
        const quantity = body.quantity || 10;
        const customerId = await createOrGetCustomer(env, session.user.id, session.user.email);
        const checkoutUrl = await createTaskPurchaseSession(env, customerId, quantity, returnUrl);
        return Response.json({ url: checkoutUrl });
      }

      if (url.pathname === "/api/billing/portal" && request.method === "POST") {
        const customerId = await createOrGetCustomer(env, session.user.id, session.user.email);
        const portalUrl = await createPortalSession(env, customerId, returnUrl);
        return Response.json({ url: portalUrl });
      }

      if (url.pathname === "/api/billing/update-quantity" && request.method === "POST") {
        const body = await request.json<{ quantity?: number }>();
        const quantity = body.quantity;
        if (!quantity || quantity < 1 || quantity > 100) {
          return Response.json({ error: "Invalid quantity" }, { status: 400 });
        }
        const result = await updateSubscriptionQuantity(env, session.user.id, quantity);
        if (!result.success) {
          return Response.json({ error: result.error }, { status: 400 });
        }
        return Response.json({ ok: true, quantity });
      }

      if (url.pathname === "/api/billing/status" && request.method === "GET") {
        const billing = await env.DB.prepare(
          `SELECT task_credits, tasks_used, subscription_status, subscribed_company_count FROM user_billing WHERE user_id = ?`
        )
          .bind(session.user.id)
          .first<{ task_credits: number; tasks_used: number; subscription_status: string; subscribed_company_count: number }>();

        return Response.json({
          hasActiveSubscription: billing?.subscription_status === "active",
          taskCredits: billing?.task_credits ?? 50,
          tasksUsed: billing?.tasks_used ?? 0,
          subscribedCompanyCount: billing?.subscribed_company_count ?? 0,
        });
      }

      return new Response("Not found", { status: 404 });
    }

    // --- API: Companies ---
    if (url.pathname === "/api/companies") {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session)
        return Response.json({ error: "Unauthorized" }, { status: 401 });

      if (request.method === "POST") {
        // Check company limit based on subscription
        const billing = await env.DB.prepare(
          `SELECT subscription_status, subscribed_company_count FROM user_billing WHERE user_id = ?`
        )
          .bind(session.user.id)
          .first<{ subscription_status: string; subscribed_company_count: number }>();

        const subscribedCount = billing?.subscribed_company_count ?? 0;
        const hasSubscription = billing?.subscription_status === "active";

        if (hasSubscription) {
          const { results: existing } = await env.DB.prepare(
            `SELECT id FROM "company" WHERE user_id = ?`
          )
            .bind(session.user.id)
            .all();

          if (existing.length >= subscribedCount) {
            return Response.json(
              { error: `You can only have ${subscribedCount} company${subscribedCount === 1 ? "" : "ies"} with your current subscription. Upgrade to add more.` },
              { status: 403 }
            );
          }
        }

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

        // Initialize the Durable Object and create initial tasks
        const doId = env.COMPANY_DO.idFromName(id);
        const stub = env.COMPANY_DO.get(doId);
        await stub.fetch(
          new Request("https://do/init", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              method: body.method,
              sourceInput: body.sourceInput || undefined,
              companyId: id,
              companyName: name,
              companySlug: finalSlug,
              userEmail: session.user.email || undefined,
              userName: session.user.name || undefined,
            }),
          })
        );

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

    // --- API: Delete a company ---
    const deleteCompanyMatch = url.pathname.match(/^\/api\/companies\/([^/]+)$/);
    if (deleteCompanyMatch && request.method === "DELETE") {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session)
        return Response.json({ error: "Unauthorized" }, { status: 401 });

      const companyId = deleteCompanyMatch[1];
      const company = await env.DB.prepare(
        `SELECT * FROM "company" WHERE id = ? AND user_id = ?`
      )
        .bind(companyId, session.user.id)
        .first<Company>();

      if (!company)
        return Response.json({ error: "Not found" }, { status: 404 });

      // Destroy the Durable Object's data
      const doId = env.COMPANY_DO.idFromName(companyId);
      const stub = env.COMPANY_DO.get(doId);
      await stub.fetch(new Request("https://do/destroy", { method: "DELETE" }));

      await env.DB.prepare(`DELETE FROM "company" WHERE id = ? AND user_id = ?`)
        .bind(companyId, session.user.id)
        .run();

      return Response.json({ ok: true });
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

      // Compute company index (0-based, ordered by creation date ASC)
      const { results: allCompanies } = await env.DB.prepare(
        `SELECT id FROM "company" WHERE user_id = ? ORDER BY created_at ASC`
      )
        .bind(session.user.id)
        .all<{ id: string }>();
      const companyIndex = allCompanies.findIndex((c) => c.id === companyId);

      // Fetch subscribed company count
      const userBilling = await env.DB.prepare(
        `SELECT subscription_status, subscribed_company_count FROM user_billing WHERE user_id = ?`
      )
        .bind(session.user.id)
        .first<{ subscription_status: string; subscribed_company_count: number }>();
      const subscribedCount = userBilling?.subscribed_company_count ?? 0;
      const isSubscribed = userBilling?.subscription_status === "active";
      const companyOverLimit = isSubscribed && companyIndex >= subscribedCount;

      // Forward to DO with company metadata headers
      const doHeaders = new Headers(request.headers);
      doHeaders.set("x-company-id", company.id);
      doHeaders.set("x-company-slug", company.slug);
      doHeaders.set("x-company-name", company.name);
      doHeaders.set("x-company-user-id", company.user_id);
      doHeaders.set("x-user-email", session.user.email || "");
      doHeaders.set("x-user-name", session.user.name || "");
      doHeaders.set("x-company-over-limit", companyOverLimit ? "1" : "0");

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

      // Fetch billing status
      const billing = await env.DB.prepare(
        `SELECT task_credits, tasks_used, subscription_status, subscribed_company_count FROM user_billing WHERE user_id = ?`
      )
        .bind(session.user.id)
        .first<{ task_credits: number; tasks_used: number; subscription_status: string; subscribed_company_count: number }>();

      const billingData = {
        hasActiveSubscription: billing?.subscription_status === "active",
        taskCredits: billing?.task_credits ?? 50,
        tasksUsed: billing?.tasks_used ?? 0,
        subscribedCompanyCount: billing?.subscribed_company_count ?? 0,
      };

      const name = session.user.name || session.user.email;
      return new Response(
        dashboardHTML(name, companies, selectedCompany, companyData, url.host, billingData),
        {
          headers: { "Content-Type": "text/html;charset=utf-8" }
        }
      );
    }

    // --- Static pages ---
    const staticPages: Record<string, string> = {
      "/": indexPageHTML,
      "/new": newPageHTML,
      "/about": aboutPageHTML,
      "/terms": termsPageHTML,
      "/privacy": privacyPageHTML
    };
    const staticPage = staticPages[url.pathname];
    if (staticPage) {
      return new Response(staticPage, {
        headers: { "Content-Type": "text/html;charset=utf-8" }
      });
    }

    return new Response("Not found", { status: 404 });
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
