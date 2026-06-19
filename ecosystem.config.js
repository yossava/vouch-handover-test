// PM2 process config for the deployed service (Windows VPS, behind a Cloudflare Tunnel -> :3003).
// The app self-loads .env from this directory (see src/index.ts), so PORT and DEEPSEEK_API_KEY
// are read from <repo>/.env. Start with:  pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "vouch-handover",
      script: "dist/index.js",
      cwd: __dirname,
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
