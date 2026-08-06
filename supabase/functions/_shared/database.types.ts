export type CommercialDatabase = {
  public: {
    Tables: {
      stripe_tree_events: {
        Row: { event_id: string; event_type: string; processed_at: string };
        Insert: { event_id: string; event_type: string; processed_at?: string };
        Update: Partial<{ event_id: string; event_type: string; processed_at: string }>;
        Relationships: [];
      };
      tree_accounts: {
        Row: {
          created_at: string;
          free_tree_limit: number;
          free_trees_used: number;
          paid_tree_credits: number;
          unlimited_trees: boolean;
          stripe_customer_id: string | null;
          total_trees_created: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          free_tree_limit?: number;
          free_trees_used?: number;
          paid_tree_credits?: number;
          unlimited_trees?: boolean;
          stripe_customer_id?: string | null;
          total_trees_created?: number;
          user_id: string;
        };
        Update: Partial<{
          free_tree_limit: number;
          free_trees_used: number;
          paid_tree_credits: number;
          unlimited_trees: boolean;
          stripe_customer_id: string | null;
          total_trees_created: number;
          updated_at: string;
        }>;
        Relationships: [];
      };
      tree_credit_orders: {
        Row: {
          created_at: string;
          currency: string;
          fulfilled_at: string | null;
          id: string;
          quantity: number;
          status: string;
          stripe_checkout_session_id: string | null;
          stripe_payment_intent_id: string | null;
          unit_amount_cents: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          currency?: string;
          fulfilled_at?: string | null;
          id?: string;
          quantity?: number;
          status?: string;
          stripe_checkout_session_id?: string | null;
          stripe_payment_intent_id?: string | null;
          unit_amount_cents?: number;
          user_id: string;
        };
        Update: Partial<{
          currency: string;
          fulfilled_at: string | null;
          quantity: number;
          status: string;
          stripe_checkout_session_id: string | null;
          stripe_payment_intent_id: string | null;
          unit_amount_cents: number;
          updated_at: string;
        }>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
