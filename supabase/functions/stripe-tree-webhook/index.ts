import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { CommercialDatabase } from "../_shared/database.types.ts";
import {
  eventClaimOutcome,
  paidTreeOrderUpdate,
  treeCheckoutEventAction,
  treeCheckoutReference,
  treeOrderFulfilmentOutcome,
  webhookRejection,
} from "./logic.ts";

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
const webhookSecret = Deno.env.get("STRIPE_TREE_WEBHOOK_SECRET") || "";
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export default {
  fetch: withSupabase({ auth: "none" }, async (request, context) => {
    const signature = request.headers.get("stripe-signature");
    const rejection = webhookRejection({
      method: request.method,
      configured: Boolean(stripe && webhookSecret),
      signature,
    });
    if (rejection) {
      if (rejection.status === 503) console.error("Stripe tree webhook is not configured");
      return Response.json({ error: rejection.error }, { status: rejection.status });
    }

    let event: Stripe.Event;
    try {
      event = await stripe!.webhooks.constructEventAsync(
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
    const claim = eventClaimOutcome(claimError);
    if (claim === "duplicate") return Response.json({ received: true });
    if (claim === "failed") {
      console.error("Could not claim Stripe event", claimError);
      return Response.json({ error: "could not claim event" }, { status: 500 });
    }

    try {
      const action = treeCheckoutEventAction(event.type);
      if (action === "ignore") return Response.json({ received: true });

      const session = event.data.object as Stripe.Checkout.Session;
      const reference = treeCheckoutReference(session);
      if (!reference) throw new Error("tree checkout metadata is incomplete");
      const { orderId, userId } = reference;

      if (action === "expire") {
        const { error: expireError } = await admin
          .from("tree_credit_orders")
          .update({ status: "expired" })
          .eq("id", orderId)
          .eq("user_id", userId)
          .eq("status", "pending");
        if (expireError) throw expireError;
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
      if (!fulfilledOrder) {
        const { data: existingOrder, error: existingOrderError } = await admin
          .from("tree_credit_orders")
          .select("id,status")
          .eq("id", orderId)
          .eq("user_id", userId)
          .eq("unit_amount_cents", 3000)
          .eq("currency", "eur")
          .maybeSingle();
        if (existingOrderError) throw existingOrderError;
        const outcome = treeOrderFulfilmentOutcome({ updatedOrder: fulfilledOrder, existingOrder });
        if (outcome === "unmatched") {
          throw new Error("matching pending or fulfilled tree order was not found");
        }
      }

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
