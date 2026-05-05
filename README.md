# Vidyasetu

Vidyasetu is a peer-to-peer micro-learning platform where students can exchange skills, book 1:1 sessions, and earn "Time Coins." It features a dual-mode interface allowing anyone to seamlessly switch between being a student and a teacher.

## 🚀 Tech Stack
- **Frontend**: Pure Vanilla HTML, CSS, and JavaScript. No bulky frameworks, extremely fast.
- **Backend & Database**: Supabase (PostgreSQL, Authentication, Realtime)
- **API Architecture**: Vercel Serverless Edge Functions (`/api/*`)
- **Hosting**: Vercel (unified Vercel Edge hosting for both Frontend & Backend)

## 📁 Repository Structure
- `*.html`: View templates (Dashboard, Explore, Booking, Wallet, etc.)
- `api.js`: The central API client handling all frontend-to-backend communication.
- `ui-system.css`: The comprehensive design system, CSS variables, and global UI components.
- `api/`: Vercel Serverless Edge Functions (Node.js). These process secure backend operations like locking escrow coins, sending OTPs, and verifying code.
- `vidyasetu_backend/vidyasetu-backend/supabase/migrations/`: SQL migration files used to set up the Supabase PostgreSQL database tables and Row Level Security policies.

## 🛠 Local Development

### 1. Environment Setup
Rename `.env.local.example` to `.env.local` or edit `config.example.js` and rename it to `config.js`. You will need:
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Your Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY`: Your secure backend key (only used in Vercel)
- `NVIDIA_API_KEY`: Used for AI Code Question generation (server-side only)

To run the frontend locally, simply serve the HTML files using any basic static server:
```bash
npx serve .
```
Or open the folder in VS Code and use the "Live Server" extension.

### 2. Testing Serverless Functions Locally
To test the `/api/*` Vercel endpoints locally alongside your frontend:
```bash
npm i -g vercel
npx vercel dev
```

## ☁️ Deployment to Vercel
Vidyasetu is architected for zero-config unified deployment on [Vercel](https://vercel.com).
1. Push this repository to GitHub.
2. Import the repository into Vercel.
3. In Vercel's **Environment Variables** dashboard, add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `NVIDIA_API_KEY`.
4. Click Deploy. Vercel will automatically host the massive HTML interface natively on Edge CDNs while dynamically compiling the `api/` directory into secure backend serverless endpoints.

## 🔒 Security
- **No API Keys in Frontend Code:** Vercel automatically runs `generate-config.sh` at build time to securely inject frontend API keys into memory.
- **Service Role Isolation:** High-privilege tasks (like deducting wallet balances for escrow) are strongly isolated in the Vercel Serverless `/api/` functions so clients cannot tamper with economies.
- **Supabase RLS:** All database tables have strict Row Level Security policies to guarantee users can only access their own data.
