# EasyRide

A working taxi booking system: passenger booking, admin-managed drivers, live
booking updates (Socket.IO), payments (Stripe, mock by default), and a full
complaint-management system compliant with NZ Transport Agency requirements
(2-year retention, serious-incident escalation, driver response trail).

> An earlier session left behind planning docs and a standalone complaint
> model/routes describing an aspirational spec but no runnable app. This
> README and the `backend/` + `frontend/` folders are the actual,
> implementation - that session's `Complaint.js` / `complaint-routes.js`
> were carried over and adapted into `backend/models/Complaint.js` /
> `backend/routes/complaints.js`.

## Stack

- **Backend**: Node.js + Express, Socket.IO, JWT auth, Stripe (optional), an
  in-memory data layer (`backend/lib/MemoryStore.js`) that mirrors the
  Mongoose query API used by the original complaint model - swap in real
  MongoDB later without rewriting routes.
- **Frontend**: React + Vite, React Router, Zustand, Axios, Socket.IO client.
  Plain CSS, responsive down to ~360px phone width.

## Run locally

Requires [Node.js](https://nodejs.org) 18+ (not currently installed on this
machine - install it first).

```bash
# Backend
cd backend
npm install
cp .env.example .env    # already done; edit if you want real SMTP/Stripe
npm start                # http://localhost:5000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev               # http://localhost:5173
```

On first boot the backend seeds three demo accounts (password `password123`
for all): `admin@easyride.local`, `driver@easyride.local` (pre-approved),
`passenger@easyride.local`. Data is in-memory and resets when the backend
restarts.

## Complaint system

- Passenger: **Book a ride → complete a trip → Lodge complaint** (from My
  bookings) or the "My complaints" nav link.
- Driver: **Complaints** nav link - view and respond to complaints filed
  against them.
- Admin: **Complaints** nav link - filter by status, add internal notes,
  change status, escalate serious incidents (assault/violence, sexual
  offence, DUI/drugs are auto-flagged serious on creation), and pull a
  compliance report (`GET /api/complaints/admin/compliance-report`).

## Deploying

**You never need to paste GitHub or Vercel credentials into a chat.** Both
platforms authenticate through your browser when you connect them yourself.

1. **Push to GitHub**
   - Create an empty repo at github.com (no README/license, so it doesn't
     conflict with this one).
   - In this folder:
     ```bash
     git remote add origin https://github.com/<you>/<repo>.git
     git branch -M main
     git push -u origin main
     ```
   - The push will prompt a browser sign-in the first time (Git Credential
     Manager) - complete that in your own browser window.

2. **Frontend on Vercel** (zero CLI needed)
   - vercel.com → Add New Project → Import your GitHub repo.
   - Set **Root Directory** to `frontend`.
   - Framework preset: Vite (auto-detected). Build command `npm run build`,
     output `dist` (defaults are already correct).
   - Add env var `VITE_API_URL` = your deployed backend's `/api` URL (e.g.
     `https://your-backend.onrender.com/api`) and `VITE_SOCKET_URL` = the
     backend's base URL. Redeploy after the backend is live.

3. **Backend** - **not** Vercel: this backend holds data in memory and runs
   a persistent Socket.IO server, which don't fit Vercel's serverless
   functions (stateless, short-lived - your data and sockets would drop).
   Use a host that runs a long-lived Node process instead, e.g.
   [Render](https://render.com) or [Railway](https://railway.app):
   - New Web Service → import the same GitHub repo.
   - Root directory `backend`, build command `npm install`, start command
     `npm start`.
   - Add the env vars from `backend/.env.example` in the dashboard
     (`JWT_SECRET` especially - set it to a real random secret, not the
     placeholder), plus `FRONTEND_URL` = your Vercel URL.
   - **Email**: Render's free tier blocks outbound SMTP, so Gmail/SMTP
     settings will never connect from there. Use Brevo (free, 300
     emails/day, sent over HTTPS) instead:
     1. Sign up at brevo.com, then *Senders & IPs → Senders → Add a
        sender* with the address you want mail to come from (e.g. the
        admin Gmail) and click the verification email it sends.
     2. *SMTP & API → API Keys → Generate a new API key*.
     3. On Render set `BREVO_API_KEY` to that key and `EMAIL_FROM` to the
        verified address. Remove any `SMTP_*` vars. Redeploy.
     Admin → *Run backup now* is a quick way to confirm mail is flowing.
   - Once live, go back to the Vercel project and set `VITE_API_URL` /
     `VITE_SOCKET_URL` to this backend's URL, then redeploy the frontend.

   Note: in-memory data resets on every backend restart/redeploy. That's
   fine for a demo; for anything real, a managed MongoDB (e.g. MongoDB
   Atlas free tier) should replace `backend/lib/MemoryStore.js` - the route
   files were written against a Mongoose-shaped API specifically so that
   swap doesn't require touching route logic.
