import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  paidTreeOrderUpdate,
  treeCheckoutEventAction,
  treeCheckoutReference,
  webhookRejection,
} from "../../supabase/functions/stripe-tree-webhook/logic.ts";
import {
  checkoutGate,
  checkoutCorsHeaders,
  isExpectedTreePrice,
} from "../../supabase/functions/create-tree-checkout/logic.ts";

const schema = readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
const webhookSource = readFileSync(
  new URL("../../supabase/functions/stripe-tree-webhook/index.ts", import.meta.url),
  "utf8",
);
const checkoutSource = readFileSync(
  new URL("../../supabase/functions/create-tree-checkout/index.ts", import.meta.url),
  "utf8",
);
const atomicMigration = readFileSync(
  new URL(
    "../../supabase/migrations/20260814035209_harden_stripe_tree_webhook_atomic.sql",
    import.meta.url,
  ),
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
  it("does all idempotency and entitlement work in one database call", () => {
    expect(webhookSource).toContain('.rpc("process_stripe_tree_event"');
    expect(webhookSource).not.toMatch(/\.from\("stripe_tree_events"\)/);
    expect(webhookSource).not.toMatch(/\.from\("tree_credit_orders"\)/);
    expect(atomicMigration).toMatch(
      /insert into public\.stripe_tree_events[\s\S]+on conflict \(event_id\) do nothing/i,
    );
    expect(atomicMigration).toMatch(/if not coalesce\(claimed, false\)[\s\S]+return 'duplicate'/i);
  });

  it("rolls the ledger claim back with every failed entitlement mutation", () => {
    // PostgreSQL functions execute in their caller's transaction. There is no
    // exception handler or secondary delete that could commit the claim alone.
    expect(atomicMigration).not.toMatch(/exception\s+when/i);
    expect(atomicMigration).not.toMatch(/delete from public\.stripe_tree_events/i);
  });
});

describe("E3 — events that arrive out of order", () => {
  it("only expires an order that is still pending", () => {
    expect(atomicMigration).toMatch(/if tree_order\.status = 'pending'[\s\S]+status = 'expired'/i);
  });

  it("lets a trusted paid event recover an earlier expired order", () => {
    expect(atomicMigration).toMatch(
      /tree_order\.status in \('pending', 'expired'\)[\s\S]+status = 'paid'/i,
    );
  });

  it("recognises both immediate and delayed payment success", () => {
    expect(treeCheckoutEventAction("checkout.session.completed")).toBe("fulfil");
    expect(treeCheckoutEventAction("checkout.session.async_payment_succeeded")).toBe("fulfil");
  });

  it("ignores events it has no business acting on", () => {
    expect(treeCheckoutEventAction("payment_intent.succeeded")).toBe("ignore");
    expect(treeCheckoutEventAction("customer.subscription.created")).toBe("ignore");
    expect(treeCheckoutEventAction("")).toBe("ignore");
  });

  it("never reverses a later refund or dispute", () => {
    expect(atomicMigration).toMatch(
      /do not let an out-of-order paid event reverse a later refund\/dispute/i,
    );
    expect(atomicMigration).toMatch(/else[\s\S]{0,150}return 'already_final'/i);
  });
});

describe("F5 — Edge Function CORS", () => {
  it("allows checkout only from this environment's exact application origin", () => {
    const headers = checkoutCorsHeaders("https://family.example");
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://family.example");
    expect(headers["Access-Control-Allow-Origin"]).not.toBe("*");
    expect(headers["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
    expect(checkoutSource).toContain("checkoutCorsHeaders(appUrl)");
  });

  it("does not expose the server-to-server Stripe webhook through CORS", () => {
    expect(webhookSource).toMatch(/auth: "none", cors: "disabled"/);
    expect(webhookSource).not.toContain('"Access-Control-Allow-Origin": "*"');
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

  it("keeps the atomic Stripe processor service-role only", () => {
    expect(atomicMigration).toMatch(
      /revoke all on function public\.process_stripe_tree_event\([\s\S]+from public, anon, authenticated/i,
    );
    expect(atomicMigration).toMatch(
      /grant execute on function public\.process_stripe_tree_event\([\s\S]+to service_role/i,
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
    // The RPC locks only a row matching both signed identifiers, then mutates
    // that exact locked row. It also binds the stored Stripe session id.
    expect(atomicMigration).toMatch(
      /where orders\.id = p_order_id\s+and orders\.user_id = p_user_id/i,
    );
    expect(atomicMigration).toMatch(
      /tree_order\.stripe_checkout_session_id is distinct from p_checkout_session_id/i,
    );
    expect(atomicMigration).toMatch(/where id = tree_order\.id/i);
  });
});
