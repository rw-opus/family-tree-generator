import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { CommercialDatabase } from "../_shared/database.types.ts";
import { paidTreeOrderUpdate, treeCheckoutEventAction } from "./logic.ts";

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
const webhookSecret = Deno.env.get("STRIPE_TREE_WEBHOOK_SECRET") || "";
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export default {
  fetch: withSupabase({ auth: "none" }, async (request, context) => {
    if (request.method !== "POST") {
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }
    if (!stripe || !webhookSecret) {
      console.error("Stripe tree webhook is not configured");
      return Response.json({ error: "webhook is not configured" }, { status: 503 });
    }

    const signature = request.headers.get("stripe-signature");
    if (!signature) return Response.json({ error: "missing signature" }, { status: 400 });

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        await request.text(),
        signature,
        webhookSecret,
      );
    } catch (error) {
      console.error("Stripe tree webhook signature failed", error);
      return Response.json({ error: "invalid signature" }, { status: 400 });
    }

    const admin = context.supabaseAdmin as SupabaseClient<CommercialDatabase>;
    const { error: claimError } = await admin
      .from("stripe_tree_events")
      .insert({ event_id: event.id, event_type: event.type });
    if (claimError?.code === "23505") return Response.json({ received: true });
    if (claimError) {
      console.error("Could not claim Stripe event", claimError);
      return Response.json({ error: "could not claim event" }, { status: 500 });
    }

    try {
      const action = treeCheckoutEventAction(event.type);
      if (action === "ignore") return Response.json({ received: true });

      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = String(session.client_reference_id || session.metadata?.order_id || "");
      const userId = String(session.metadata?.user_id || "");
      if (!orderId || !userId || session.metadata?.product !== "family_tree_credit") {
        throw new Error("tree checkout metadata is incomplete");
      }

      if (action === "expire") {
        await admin
          .from("tree_credit_orders")
          .update({ status: "expired" })
          .eq("id", orderId)
          .eq("user_id", userId)
          .eq("status", "pending");
        return Response.json({ received: true });
      }

      if (event.type === "checkout.session.completed" && session.payment_status !== "paid") {
        return Response.json({ received: true });
      }

      const orderUpdate = paidTreeOrderUpdate(session);
      const { data: fulfilledOrder, error: fulfilError } = await admin
        .from("tree_credit_orders")
        .update(orderUpdate)
        .eq("id", orderId)
        .eq("user_id", userId)
        .eq("unit_amount_cents", 3000)
        .eq("currency", "eur")
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (fulfilError) throw fulfilError;
      if (!fulfilledOrder) throw new Error("matching pending tree order was not found");

      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id || "";
      if (customerId) {
        const { error: customerError } = await admin
          .from("tree_accounts")
          .update({ stripe_customer_id: customerId })
          .eq("user_id", userId);
        if (customerError) throw customerError;
      }

      return Response.json({ received: true });
    } catch (error) {
      await admin.from("stripe_tree_events").delete().eq("event_id", event.id);
      console.error("Stripe tree webhook processing failed", error);
      return Response.json({ error: "webhook processing failed" }, { status: 500 });
    }
  }),
};
