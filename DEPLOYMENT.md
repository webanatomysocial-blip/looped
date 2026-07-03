# Deployment Guide — agency.webanatomy.in

## Local Development

```bash
# Backend (port 4001, SQLite)
cd backend && npm install && npm run dev

# Frontend (port 5173, proxies /api → :4001)
cd frontend && npm install && npm run dev
```

---

## Build for Production

Run from the project root (builds frontend → `backend/public/`, then compiles backend TypeScript):

```bash
cd frontend && npm install && npm run build
cd ../backend && npm install && npm run build
```

After this you'll have:
- `backend/public/`  — built frontend (served by Express)
- `backend/dist/`    — compiled Node.js server

---

## Hostinger Deployment

### What to upload

Upload the entire `backend/` folder to your Hostinger Node.js app directory. It contains:
- `dist/`          — compiled server
- `public/`        — built frontend (served by Express at `/`)
- `uploads/`       — user-uploaded files
- `service-account.json` — Google service account
- `node_modules/`  — (run `npm install --omit=dev` on server instead if possible)

### Environment file

Rename `.env.production` → `.env` on the server (or copy the values into Hostinger's environment variable panel):

```
NODE_ENV=production
PORT=4001
JWT_SECRET=cfbaca184beda244f2130e3d40d6020efa5a6eef7a70d00f0b8e3db518653684d4dbde9b1fe4ff32fdefa948e160135e
FRONTEND_URL=https://agency.webanatomy.in

GMAIL_USER=webanatomysocial@gmail.com
GMAIL_APP_PASSWORD=covulxytzghogfqq
MAIL_FROM_NAME=Workdeck

GOOGLE_SERVICE_ACCOUNT_PATH=./service-account.json
GEMINI_API_KEY=AQ.Ab8RN6JI4jkmEx1aMwgeCQ2e5OzxLAfp18Z7I0JPv7nXLmf9jw

DB_HOST=localhost
DB_PORT=3306
DB_NAME=u813645463_agency
DB_USER=u813645463_agency
DB_PASS=!4Z2E>RRHJ(_PD5y+NxC£b$t
```

### Entry point

In Hostinger Node.js settings set:
- **Entry file:** `dist/server.js`
- **Node version:** 18+ (LTS)

Or start manually:
```bash
node dist/server.js
```

### MySQL

The app auto-creates all tables on first boot. Ensure the MySQL user has `CREATE TABLE` permission on `u813645463_agency`.

### How it works in production

```
Browser → https://agency.webanatomy.in
         ↓
    Express (dist/server.js)
    ├─ /api/*      → API routes (MySQL)
    ├─ /uploads/*  → static files from backend/uploads/
    └─ /*          → backend/public/index.html (React SPA)
```

No separate web server or reverse proxy needed — Express serves everything.

---

## Updating after code changes

```bash
# On your local machine:
cd frontend && npm run build        # rebuilds frontend → backend/public/
cd ../backend && npm run build      # recompiles TypeScript → backend/dist/

# Then re-upload backend/dist/ and backend/public/ to server
# Restart the Node.js app in Hostinger panel
```
