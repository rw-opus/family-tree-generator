import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Database-backed proof for the Stripe entitlement transaction. These tests
 * call PostgREST directly against the fresh local Supabase stack used in CI.
 */

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    "Stripe RPC tests need SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const json = async (response) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
};

const request = (path, { token = serviceRoleKey, method = "GET", body, prefer } = {}) =>
  fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: token === serviceRoleKey ? serviceRoleKey : anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const authAdmin = (path, init = {}) =>
  fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

const invoke = (token, body) =>
  request("rpc/process_stripe_tree_event", { token, method: "POST", body });

const eventBody = ({ eventId, eventType, order, amount = 3000, paymentIntent }) => ({
  p_amount_total: amount,
  p_checkout_session_id: order.stripe_checkout_session_id,
  p_currency: "eur",
  p_customer_id: null,
  p_event_id: eventId,
  p_event_type: eventType,
  p_order_id: order.id,
  p_payment_intent_id: paymentIntent ?? null,
  p_payment_status: eventType.includes("succeeded") ? "paid" : "unpaid",
  p_user_id: order.user_id,
});

describe("atomic Stripe tree-credit processing", () => {
  const stamp = crypto.randomUUID().replaceAll("-", "");
  let user;

  const createOrder = async (name) => {
    const sessionId = `cs_test_${stamp}_${name}`;
    const response = await request("tree_credit_orders", {
      method: "POST",
      prefer: "return=representation",
      body: { user_id: user.id, stripe_checkout_session_id: sessionId },
    });
    const rows = await json(response);
    if (!response.ok) throw new Error(`Could not create test order: ${JSON.stringify(rows)}`);
    return rows[0];
  };

  const accountCredits = async () => {
    const response = await request(`tree_accounts?user_id=eq.${user.id}&select=paid_tree_credits`, {
      token: user.token,
    });
    const rows = await json(response);
    return rows[0].paid_tree_credits;
  };

  const orderStatus = async (orderId) => {
    const response = await request(`tree_credit_orders?id=eq.${orderId}&select=status`);
    const rows = await json(response);
    return rows[0].status;
  };

  beforeAll(async () => {
    const password = `Fictional-${crypto.randomUUID()}`;
    const email = `stripe-${stamp}@fictional.invalid`;
    const created = await authAdmin("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!created.ok) throw new Error(`Could not create Stripe test user: ${await created.text()}`);
    user = await created.json();

    const signedIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!signedIn.ok)
      throw new Error(`Could not sign in Stripe test user: ${await signedIn.text()}`);
    const session = await signedIn.json();
    user.token = session.access_token;

    // Exercise the normal entitlement trigger instead of granting the test
    // harness administrative write access to tree_accounts.
    const treeId = crypto.randomUUID();
    const seeded = await request("family_trees", {
      token: user.token,
      method: "POST",
      body: {
        id: treeId,
        title: "Fictional Stripe security tree",
        people: [],
        tree_data: { id: treeId, title: "Fictional Stripe security tree", people: [] },
      },
    });
    if (!seeded.ok) throw new Error(`Could not seed Stripe test account: ${await seeded.text()}`);
  }, 60_000);

  afterAll(async () => {
    if (user?.id) await authAdmin(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
  });

  it("cannot be invoked by an authenticated browser or anonymously", async () => {
    const body = {
      p_amount_total: null,
      p_checkout_session_id: null,
      p_currency: null,
      p_customer_id: null,
      p_event_id: `evt_${stamp}_forged`,
      p_event_type: "customer.updated",
      p_order_id: null,
      p_payment_intent_id: null,
      p_payment_status: null,
      p_user_id: null,
    };

    const [authenticated, anonymous] = await Promise.all([
      invoke(user.token, body),
      invoke(anonKey, body),
    ]);

    expect(authenticated.ok).toBe(false);
    expect(anonymous.ok).toBe(false);
  });

  it("lets a later valid payment win over expiry exactly once", async () => {
    const order = await createOrder("out_of_order");
    const startingCredits = await accountCredits();
    const expiredId = `evt_${stamp}_expired`;
    const paidId = `evt_${stamp}_paid`;
    const staleFailureId = `evt_${stamp}_stale_failure`;
    const expired = await invoke(
      serviceRoleKey,
      eventBody({ eventId: expiredId, eventType: "checkout.session.expired", order }),
    );
    expect(expired.ok).toBe(true);
    expect(await json(expired)).toBe("expired");
    expect(await orderStatus(order.id)).toBe("expired");
    expect(await accountCredits()).toBe(startingCredits);

    const paidBody = eventBody({
      eventId: paidId,
      eventType: "checkout.session.async_payment_succeeded",
      order,
      paymentIntent: `pi_${stamp}_paid`,
    });
    const paid = await invoke(serviceRoleKey, paidBody);
    expect(paid.ok).toBe(true);
    expect(await json(paid)).toBe("paid");
    expect(await orderStatus(order.id)).toBe("paid");
    expect(await accountCredits()).toBe(startingCredits + 1);

    const duplicate = await invoke(serviceRoleKey, paidBody);
    expect(duplicate.ok).toBe(true);
    expect(await json(duplicate)).toBe("duplicate");
    expect(await accountCredits()).toBe(startingCredits + 1);

    const staleFailure = await invoke(
      serviceRoleKey,
      eventBody({
        eventId: staleFailureId,
        eventType: "checkout.session.async_payment_failed",
        order,
      }),
    );
    expect(staleFailure.ok).toBe(true);
    expect(await json(staleFailure)).toBe("already_final");
    expect(await orderStatus(order.id)).toBe("paid");
    expect(await accountCredits()).toBe(startingCredits + 1);
  });

  it("rolls back a failed claim so the same event can be retried", async () => {
    const order = await createOrder("retry");
    const startingCredits = await accountCredits();
    const eventId = `evt_${stamp}_retry`;
    const paymentIntent = `pi_${stamp}_retry`;
    const invalidBody = eventBody({
      amount: 2999,
      eventId,
      eventType: "checkout.session.async_payment_succeeded",
      order,
      paymentIntent,
    });

    const invalid = await invoke(serviceRoleKey, invalidBody);
    expect(invalid.ok).toBe(false);

    expect(await orderStatus(order.id)).toBe("pending");

    const retry = await invoke(serviceRoleKey, { ...invalidBody, p_amount_total: 3000 });
    expect(retry.ok).toBe(true);
    expect(await json(retry)).toBe("paid");
    expect(await orderStatus(order.id)).toBe("paid");
    expect(await accountCredits()).toBe(startingCredits + 1);
  });

  it("serialises simultaneous redelivery and grants only one credit", async () => {
    const order = await createOrder("concurrent");
    const startingCredits = await accountCredits();
    const eventId = `evt_${stamp}_concurrent`;
    const body = eventBody({
      eventId,
      eventType: "checkout.session.async_payment_succeeded",
      order,
      paymentIntent: `pi_${stamp}_concurrent`,
    });

    const responses = await Promise.all([
      invoke(serviceRoleKey, body),
      invoke(serviceRoleKey, body),
    ]);
    expect(responses.every((response) => response.ok)).toBe(true);
    const outcomes = await Promise.all(responses.map(json));
    expect(outcomes.sort()).toEqual(["duplicate", "paid"]);
    expect(await accountCredits()).toBe(startingCredits + 1);
  });
});
