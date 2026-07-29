# Property Succession Calculator

A Maltese property ownership and succession calculator. It combines a family tree with intestate and testamentary inheritance modelling, causa mortis declarations, fractional ownership transfers, and indicative property-tax calculations.

## Start locally

1. Copy `.env.example` to `.env`.
2. For cloud storage, create a separate Supabase project and run `supabase/schema.sql` in its SQL Editor.
3. Add its project URL and publishable key to `.env`.
4. Run `npm install` then `npm run dev`.

Trees are automatically restored from the browser on the same device, including after a refresh or accidental close. Once Supabase is configured, each signed-in user can also save and reopen the complete case across devices. Row Level Security enforces that separation.

## Deployment readiness

The project is Vite-ready for Railway or another Node host. Railway builds with `npm run build` and serves the generated SPA with `npm start`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the deployment environment before building to enable cloud persistence.
