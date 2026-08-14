import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { CommercialDatabase } from "../_shared/database.types.ts";
import {
  paidTreeOrderUpdate,
  treeCheckoutEventAction,
  treeCheckoutReference,
  webhookRejection,
} from "./logic.ts";

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
const webhookSecret = Deno.env.get("STRIPE_TREE_WEBHOOK_SECRET") || "";
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export default {
  // Stripe is a server-to-server caller. It never needs browser CORS, and
  // disabling the wrapper default avoids advertising a wildcard origin.
  fetch: withSupabase({ auth: "none", cors: "disabled" }, async (request, context) => {
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
        signature!,
        webhookSecret,
      );
    } catch (error) {
      console.error("Stripe tree webhook signature failed", error);
      return Response.json({ error: "invalid signature" }, { status: 400 });
    }

    try {
      const action = treeCheckoutEventAction(event.type);
      const session = action === "ignore" ? null : (event.data.object as Stripe.Checkout.Session);
      const reference = session ? treeCheckoutReference(session) : null;
      if (session && !reference) throw new Error("tree checkout metadata is incomplete");

      const paidOrder =
        session &&
        action === "fulfil" &&
        !(event.type === "checkout.session.completed" && session.payment_status !== "paid")
          ? paidTreeOrderUpdate(session)
          : null;

      const customerId = session
        ? typeof session.customer === "string"
          ? session.customer
          : session.customer?.id || null
        : null;
      const admin = context.supabaseAdmin as SupabaseClient<CommercialDatabase>;
      const { error: processingError } = await admin.rpc("process_stripe_tree_event", {
        p_amount_total: session?.amount_total ?? null,
        p_checkout_session_id: session?.id ?? null,
        p_currency: session?.currency ?? null,
        p_customer_id: customerId,
        p_event_id: event.id,
        p_event_type: event.type,
        p_order_id: reference?.orderId ?? null,
        p_payment_intent_id: paidOrder?.stripe_payment_intent_id ?? null,
        p_payment_status: session?.payment_status ?? null,
        p_user_id: reference?.userId ?? null,
      });
      if (processingError) throw processingError;

      return Response.json({ received: true });
    } catch (error) {
      console.error("Stripe tree webhook processing failed", error);
      return Response.json({ error: "webhook processing failed" }, { status: 500 });
    }
  }),
};
