import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  eventClaimOutcome,
  paidTreeOrderUpdate,
  treeCheckoutEventAction,
  treeCheckoutReference,
  treeOrderFulfilmentOutcome,
  webhookRejection,
} from "../../supabase/functions/stripe-tree-webhook/logic.ts";
import {
  checkoutGate,
  isExpectedTreePrice,
} from "../../supabase/functions/create-tree-checkout/logic.ts";

const schema = readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
const webhookSource = readFileSync(
  new URL("../../supabase/functions/stripe-tree-webhook/index.ts", import.meta.url),
  "utf8",
);

/** Every policy statement in the schema, as { table, command, roles }. */
const policies = [
  ...schema.matchAll(/create policy\s+"([^"]+)"\s+on\s+([\w.]+)\s+for\s+(\w+)/gi),
].map((match) => ({ name: match[1], table: match[2], command: match[3].toLowerCase() }));

const grantsFor = (table) =>
  [...schema.matchAll(/grant\s+([^;]+?)\s+on\s+table\s+([\w.]+)\s+to\s+([^;]+);/gi)]
    .filter((match) => match[2] === table)
    .flatMap((match) =>
      match[1].split(",").map((privilege) => ({
        privilege: privilege.trim().toLowerCase(),
        roles: match[3].split(",").map((role) => role.trim().toLowerCase()),
      })),
    );

describe("E1 — the webhook refuses anything it cannot verify", () => {
  it("rejects a request that is not a POST", () => {
    expect(webhookRejection({ method: "GET", configured: true, signature: "t=1,v1=abc" })).toEqual({
      status: 405,
      error: "method not allowed",
    });
  });

  it("refuses to serve at all when the signing secret is not configured", () => {
    // Accepting events without a secret would mean trusting anyone who can
    // reach the URL, so an unconfigured deployment fails closed.
    expect(
      webhookRejection({ method: "POST", configured: false, signature: "t=1,v1=abc" }),
    ).toEqual({ status: 503, error: "webhook is not configured" });
  });

  it("rejects an unsigned payload", () => {
    expect(webhookRejection({ method: "POST", configured: true, signature: null })).toEqual({
      status: 400,
      error: "missing signature",
    });
    expect(webhookRejection({ method: "POST", configured: true, signature: "" })).toEqual({
      status: 400,
      error: "missing signature",
    });
  });

  it("admits a signed POST to the verifying step", () => {
    expect(
      webhookRejection({ method: "POST", configured: true, signature: "t=1,v1=abc" }),
    ).toBeNull();
  });

  it("verifies the signature against the raw body before acting on the event", () => {
    // constructEventAsync throws on a bad signature; the catch must answer 400
    // and the handler must never read event data before that point.
    expect(webhookSource).toContain("constructEventAsync");
    expect(webhookSource).toMatch(/catch[\s\S]{0,200}invalid signature/);
    const verifyIndex = webhookSource.indexOf("constructEventAsync");
    expect(webhookSource.indexOf("event.data.object")).toBeGreaterThan(verifyIndex);
  });
});

describe("E2 — a redelivered event cannot pay twice", () => {
  it("treats a unique violation on the ledger as an already-handled event", () => {
    expect(eventClaimOutcome({ code: "23505" })).toBe("duplicate");
  });

  it("claims an event the first time it is seen", () => {
    expect(eventClaimOutcome(null)).toBe("claimed");
  });

  it("does not silently swallow a real ledger failure", () => {
    expect(eventClaimOutcome({ code: "08006" })).toBe("failed");
  });

  it("accepts a redelivery that finds the order already paid", () => {
    expect(
      treeOrderFulfilmentOutcome({ updatedOrder: null, existingOrder: { status: "paid" } }),
    ).toBe("already-fulfilled");
  });

  it("still reports an order that matches nothing at all", () => {
    expect(treeOrderFulfilmentOutcome({ updatedOrder: null, existingOrder: null })).toBe(
      "unmatched",
    );
  });

  it("claims the ledger row before doing any work", () => {
    const claimIndex = webhookSource.indexOf("stripe_tree_events");
    const fulfilIndex = webhookSource.indexOf("tree_credit_orders");
    expect(claimIndex).toBeGreaterThan(-1);
    expect(claimIndex).toBeLessThan(fulfilIndex);
  });

  it("releases the claim when processing fails, so a retry can still succeed", () => {
    expect(webhookSource).toMatch(/from\("stripe_tree_events"\)\s*\.delete\(\)/);
  });
});

describe("E3 — events that arrive out of order", () => {
  it("only ever expires an order that is still pending", () => {
    // An expiry arriving after payment must not un-pay the order, which is
    // enforced by the status guard on the update rather than by event order.
    expect(webhookSource).toMatch(/status: "expired"[\s\S]{0,200}\.eq\("status", "pending"\)/);
  });

  it("only ever fulfils an order that is still pending", () => {
    expect(webhookSource).toMatch(/orderUpdate[\s\S]{0,300}\.eq\("status", "pending"\)/);
  });

  it("treats a second fulfilling event as complete rather than as an error", () => {
    // checkout.session.completed and async_payment_succeeded both fulfil, and
    // either may arrive first.
    expect(treeCheckoutEventAction("checkout.session.completed")).toBe("fulfil");
    expect(treeCheckoutEventAction("checkout.session.async_payment_succeeded")).toBe("fulfil");
    expect(
      treeOrderFulfilmentOutcome({ updatedOrder: null, existingOrder: { status: "paid" } }),
    ).toBe("already-fulfilled");
  });

  it("ignores events it has no business acting on", () => {
    expect(treeCheckoutEventAction("payment_intent.succeeded")).toBe("ignore");
    expect(treeCheckoutEventAction("customer.subscription.created")).toBe("ignore");
    expect(treeCheckoutEventAction("")).toBe("ignore");
  });
});

describe("E4 — a browser cannot grant itself an entitlement", () => {
  it("gives the browser read-only access to its own allowance", () => {
    // No insert, update or delete grant means no amount of client-side
    // tampering can add credits: the request is refused by Postgres.
    for (const table of [
      "public.tree_accounts",
      "public.tree_credit_orders",
      "public.tree_generations",
    ]) {
      const granted = grantsFor(table).map((grant) => grant.privilege);
      expect(granted).toEqual(["select"]);
    }
  });

  it("gives the browser no policy at all for writing entitlement tables", () => {
    for (const table of [
      "public.tree_accounts",
      "public.tree_credit_orders",
      "public.tree_generations",
    ]) {
      const writePolicies = policies.filter(
        (policy) => policy.table === table && policy.command !== "select",
      );
      expect(writePolicies).toEqual([]);
    }
  });

  it("keeps the Stripe idempotency ledger entirely out of reach", () => {
    expect(grantsFor("public.stripe_tree_events")).toEqual([]);
    expect(policies.filter((policy) => policy.table === "public.stripe_tree_events")).toEqual([]);
    expect(schema).toMatch(/alter table public\.stripe_tree_events enable row level security/i);
  });

  it("revokes the default grants before handing any back", () => {
    for (const table of [
      "public.family_trees",
      "public.tree_accounts",
      "public.tree_credit_orders",
      "public.tree_generations",
      "public.stripe_tree_events",
      "public.terms_acceptances",
    ]) {
      expect(schema).toMatch(
        new RegExp(
          `revoke all on table ${table.replace(".", "\\.")} from anon, authenticated`,
          "i",
        ),
      );
    }
  });

  it("lets the database, not the browser, decide whether a tree may be created", () => {
    // The allowance trigger runs security definer and is not executable by the
    // browser, so calling the Data API directly cannot bypass it.
    expect(schema).toMatch(/create trigger family_trees_consume_entitlement/i);
    expect(schema).toMatch(
      /revoke all on function private\.consume_tree_entitlement\(\) from public, anon, authenticated/i,
    );
    expect(schema).toMatch(
      /revoke all on function private\.grant_paid_tree_credit\(\) from public, anon, authenticated/i,
    );
  });

  it("refuses checkout while the account still has an entitlement to spend", () => {
    // A user cannot buy their way past the free allowance to stockpile credits.
    expect(
      checkoutGate({ free_tree_limit: 5, free_trees_used: 0, paid_tree_credits: 0 }).allowed,
    ).toBe(false);
    expect(
      checkoutGate({ free_tree_limit: 5, free_trees_used: 5, paid_tree_credits: 1 }).allowed,
    ).toBe(false);
    expect(
      checkoutGate({ free_tree_limit: 5, free_trees_used: 5, paid_tree_credits: 0 }).allowed,
    ).toBe(true);
  });

  it("accepts only the server's own price, never one supplied by the client", () => {
    expect(
      isExpectedTreePrice({ active: true, currency: "eur", unit_amount: 3000, type: "one_time" }),
    ).toBe(true);
    expect(
      isExpectedTreePrice({ active: true, currency: "eur", unit_amount: 1, type: "one_time" }),
    ).toBe(false);
    expect(
      isExpectedTreePrice({ active: true, currency: "usd", unit_amount: 3000, type: "one_time" }),
    ).toBe(false);
    expect(
      isExpectedTreePrice({ active: false, currency: "eur", unit_amount: 3000, type: "one_time" }),
    ).toBe(false);
  });

  it("credits only an exactly EUR 30 paid session", () => {
    expect(() =>
      paidTreeOrderUpdate({ payment_status: "unpaid", amount_total: 3000, currency: "eur" }),
    ).toThrow();
    expect(() =>
      paidTreeOrderUpdate({ payment_status: "paid", amount_total: 1, currency: "eur" }),
    ).toThrow();
    expect(() =>
      paidTreeOrderUpdate({ payment_status: "paid", amount_total: 3000, currency: "usd" }),
    ).toThrow();
    expect(
      paidTreeOrderUpdate({
        payment_status: "paid",
        amount_total: 3000,
        currency: "eur",
        payment_intent: "pi_1",
      }),
    ).toEqual({
      status: "paid",
      stripe_payment_intent_id: "pi_1",
    });
  });

  it("takes the order and account from Stripe's signed payload only", () => {
    expect(
      treeCheckoutReference({
        client_reference_id: "order-1",
        metadata: { user_id: "user-1", product: "family_tree_credit" },
      }),
    ).toEqual({ orderId: "order-1", userId: "user-1" });
  });

  it("refuses a session that is not this product, or is missing a reference", () => {
    expect(
      treeCheckoutReference({ client_reference_id: "order-1", metadata: { user_id: "user-1" } }),
    ).toBeNull();
    expect(
      treeCheckoutReference({
        client_reference_id: "order-1",
        metadata: { user_id: "user-1", product: "something_else" },
      }),
    ).toBeNull();
    expect(
      treeCheckoutReference({
        client_reference_id: "",
        metadata: { product: "family_tree_credit" },
      }),
    ).toBeNull();
  });

  it("scopes every entitlement write to the user named in the event", () => {
    // Without the user_id guard a forged order id could move another account's
    // order, so both identifiers must appear on the update.
    const updates = webhookSource.match(/\.eq\("id", orderId\)\s*\n\s*\.eq\("user_id", userId\)/g);
    expect(updates?.length).toBeGreaterThanOrEqual(2);
  });
});
