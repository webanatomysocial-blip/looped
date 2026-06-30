# Deployment Guide

## Local Development

### Backend

```bash
cd backend
npm install
npm run dev   # Runs on http://localhost:4001 with SQLite
```

### Frontend

```bash
cd frontend
npm install
npm run dev   # Runs on http://localhost:5173 (proxies API to :4001)
```

Default login: admin@agency.com / Admin@123

---

## Production (Hostinger)

### Backend

1. Upload `/backend` folder to your Hostinger Node.js app directory
2. Rename `.env.production` to `.env` (or set environment variables in Hostinger panel)
3. `npm install --production`
4. `npm run build` then `npm start`
   — or use `ts-node src/server.ts` if your host supports it

### Frontend

1. Run `npm run build` in the `/frontend` folder
2. Upload the `frontend/dist/` folder contents to your domain's `public_html`
3. Add a `.htaccess` (if Apache) for SPA routing:
   ```
   <IfModule mod_rewrite.c>
     RewriteEngine On
     RewriteBase /
     RewriteRule ^index\.html$ - [L]
     RewriteCond %{REQUEST_FILENAME} !-f
     RewriteCond %{REQUEST_FILENAME} !-d
     RewriteRule . /index.html [L]
   </IfModule>
   ```

### MySQL Schema

The app auto-creates all tables on first boot. Just ensure the MySQL user has CREATE TABLE permission.
