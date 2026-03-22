import { createAuth } from "./auth";

export interface Env {
  DB: D1Database;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const auth = createAuth(env);

    // Handle all Better Auth routes (/api/auth/*)
    if (url.pathname.startsWith("/api/auth")) {
      return auth.handler(request);
    }

    // Dashboard page - requires authentication
    if (url.pathname === "/dashboard") {
      const session = await auth.api.getSession({
        headers: request.headers,
      });

      if (!session) {
        // Use Better Auth's sign-in API to get the Google OAuth URL
        const signInRes = await auth.api.signInSocial({
          body: { provider: "google", callbackURL: "/dashboard" },
        });
        if (signInRes.url) {
          return Response.redirect(signInRes.url, 302);
        }
        return Response.redirect(url.origin, 302);
      }

      const name = session.user.name || session.user.email;

      return new Response(dashboardHTML(name), {
        headers: { "Content-Type": "text/html;charset=utf-8" },
      });
    }

    // Let Cloudflare assets handle everything else (index.html, /live, etc.)
    return new Response(null, { status: 404 });
  },
};

function dashboardHTML(name: string) {
  const escapedName = name
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

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
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .dashboard {
      text-align: center;
    }
    .dashboard h1 {
      font-size: 36px;
      font-weight: 700;
      margin-bottom: 16px;
    }
    .dashboard p {
      font-size: 16px;
      color: #666;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    }
    .dashboard a {
      display: inline-block;
      margin-top: 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 14px;
      color: #111;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="dashboard">
    <h1>Welcome, ${escapedName}</h1>
    <p>Your autonomous AI is ready.</p>
    <a href="#" onclick="signOut()">Sign out</a>
  </div>
  <script>
    function signOut() {
      fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      }).then(function() { window.location.href = "/"; });
    }
  </script>
</body>
</html>`;
}
