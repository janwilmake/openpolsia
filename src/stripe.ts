import Stripe from "stripe";
import type { Env } from "./types";

export function getStripe(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY);
}

export async function createOrGetCustomer(
  env: Env,
  userId: string,
  email: string
): Promise<string> {
  // Check if we already have a customer ID
  const row = await env.DB.prepare(
    `SELECT stripe_customer_id FROM user_billing WHERE user_id = ?`
  )
    .bind(userId)
    .first<{ stripe_customer_id: string | null }>();

  if (row?.stripe_customer_id) {
    return row.stripe_customer_id;
  }

  // Create Stripe customer
  const stripe = getStripe(env);
  const customer = await stripe.customers.create({
    email,
    metadata: { user_id: userId },
  });

  // Upsert into user_billing
  await env.DB.prepare(
    `INSERT INTO user_billing (user_id, stripe_customer_id) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id = ?`
  )
    .bind(userId, customer.id, customer.id)
    .run();

  return customer.id;
}

export async function createCheckoutSession(
  env: Env,
  customerId: string,
  quantity: number,
  returnUrl: string
): Promise<string> {
  const stripe = getStripe(env);
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [
      {
        price: env.STRIPE_PRICE_COMPANY,
        quantity,
      },
    ],
    subscription_data: {
      trial_period_days: 3,
    },
    success_url: `${returnUrl}?billing=success`,
    cancel_url: `${returnUrl}?billing=cancelled`,
  });
  return session.url!;
}

export async function createTaskPurchaseSession(
  env: Env,
  customerId: string,
  quantity: number,
  returnUrl: string
): Promise<string> {
  const stripe = getStripe(env);
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    line_items: [
      {
        price: env.STRIPE_PRICE_TASK,
        quantity,
      },
    ],
    metadata: { type: "task_credits", quantity: String(quantity) },
    success_url: `${returnUrl}?billing=tasks-success`,
    cancel_url: `${returnUrl}?billing=cancelled`,
  });
  return session.url!;
}

export async function createPortalSession(
  env: Env,
  customerId: string,
  returnUrl: string
): Promise<string> {
  const stripe = getStripe(env);
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

export async function handleWebhook(
  env: Env,
  request: Request
): Promise<Response> {
  const stripe = getStripe(env);
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err: any) {
    return Response.json(
      { error: "Invalid signature: " + err.message },
      { status: 400 }
    );
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription" && session.subscription) {
        // Activate company subscription
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;

        // Find user by customer ID
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id;

        if (customerId) {
          const billing = await env.DB.prepare(
            `SELECT user_id FROM user_billing WHERE stripe_customer_id = ?`
          )
            .bind(customerId)
            .first<{ user_id: string }>();

          if (billing) {
            await env.DB.prepare(
              `UPDATE user_billing SET stripe_subscription_id = ?, subscription_status = 'active'
               WHERE user_id = ?`
            )
              .bind(subId, billing.user_id)
              .run();
          }
        }
      } else if (session.mode === "payment") {
        // Task credit purchase
        const quantity = parseInt(session.metadata?.quantity || "0", 10);
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id;

        if (customerId && quantity > 0) {
          const billing = await env.DB.prepare(
            `SELECT user_id FROM user_billing WHERE stripe_customer_id = ?`
          )
            .bind(customerId)
            .first<{ user_id: string }>();

          if (billing) {
            await env.DB.prepare(
              `UPDATE user_billing SET task_credits = task_credits + ? WHERE user_id = ?`
            )
              .bind(quantity, billing.user_id)
              .run();
          }
        }
      }
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const status = sub.status === "active" || sub.status === "trialing"
        ? "active"
        : sub.status;
      await env.DB.prepare(
        `UPDATE user_billing SET subscription_status = ? WHERE stripe_subscription_id = ?`
      )
        .bind(status, sub.id)
        .run();
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await env.DB.prepare(
        `UPDATE user_billing SET subscription_status = 'cancelled', stripe_subscription_id = NULL WHERE stripe_subscription_id = ?`
      )
        .bind(sub.id)
        .run();
      break;
    }
  }

  return Response.json({ received: true });
}
