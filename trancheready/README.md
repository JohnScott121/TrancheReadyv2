# TrancheReady Starter (GitHub + Render)
Calm enterprise marketing site + minimal app server. Copy–paste ready.

## Structure
- `marketing/` — static site (landing, pricing/payment, FAQ, privacy, terms)
- `app/` — Express app (upload 2 CSVs → ZIP + verify link; Stripe checkout)

## Local dev
1) Marketing: open `marketing/index.html` in your browser (or serve the folder).
2) App:
   ```bash
   cd app
   cp .env.example .env
   npm i
   npm start
