import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { CommercialDatabase } from "../_shared/database.types.ts";
import {
  checkoutGate,
  checkoutSessionParams,
  isExpectedTreePrice,
  normaliseAppUrl,
} from "./logic.ts";

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
const stripePriceId = Deno.env.get("STRIPE_TREE_PRICE_ID") || "";
const appUrl = normaliseAppUrl(Deno.env.get("APP_URL") || "");
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") {
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }
    if (!stripe || !stripePriceId || !appUrl) {
      console.error("Tree checkout is not configured");
      return Response.json({ error: "checkout is not configured" }, { status: 503 });
    }

    const userId = String(context.userClaims?.id || "");
    const email = String(context.userClaims?.email || "");
    if (!userId || !email) {
      return Response.json({ error: "not signed in" }, { status: 401 });
    }

    const admin = context.supabaseAdmin as SupabaseClient<CommercialDatabase>;
    const { data: account, error: accountError } = await admin
      .from("tree_accounts")
      .select(
        "free_tree_limit,free_trees_used,paid_tree_credits,stripe_customer_id,unlimited_trees",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (accountError) {
      console.error("Tree account lookup failed", accountError);
      return Response.json({ error: "could not read tree allowance" }, { status: 500 });
    }

    const gate = checkoutGate(account);
    if (!gate.allowed) {
      return Response.json({ error: gate.reason }, { status: gate.status });
    }

    try {
      const configuredPrice = await stripe.prices.retrieve(stripePriceId);
      if (!isExpectedTreePrice(configuredPrice)) {
        console.error("STRIPE_TREE_PRICE_ID is not an active one-time EUR 30 price");
        return Response.json({ error: "tree price is not configured correctly" }, { status: 503 });
      }
    } catch (error) {
      console.error("Could not verify the configured Stripe tree price", error);
      return Response.json({ error: "tree price could not be verified" }, { status: 503 });
    }

    const { data: order, error: orderError } = await admin
      .from("tree_credit_orders")
      .insert({ user_id: userId })
      .select("id")
      .single();
    if (orderError || !order) {
      console.error("Tree credit order creation failed", orderError);
      return Response.json({ error: "could not create tree order" }, { status: 500 });
    }

    try {
      const session = await stripe.checkout.sessions.create(
        checkoutSessionParams({
          appUrl,
          customerId: account?.stripe_customer_id || "",
          email,
          orderId: order.id,
          priceId: stripePriceId,
          userId,
        }),
      );

      const { error: sessionUpdateError } = await admin
        .from("tree_credit_orders")
        .update({ stripe_checkout_session_id: session.id })
        .eq("id", order.id)
        .eq("user_id", userId);
      if (sessionUpdateError) throw sessionUpdateError;

      return Response.json({ url: session.url }, { status: 200 });
    } catch (error) {
      await admin
        .from("tree_credit_orders")
        .update({ status: "expired" })
        .eq("id", order.id)
        .eq("status", "pending");
      console.error("Tree checkout session creation failed", error);
      return Response.json({ error: "could not start checkout" }, { status: 500 });
    }
  }),
};
