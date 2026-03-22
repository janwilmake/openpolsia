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

export interface Company {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string | null;
  method: string;
  source_input: string | null;
  created_at: string;
}

export function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
