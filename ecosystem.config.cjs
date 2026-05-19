// PM2 配置 — Snake of Mercury 守护进程
module.exports = {
  apps: [{
    name: 'snake-server',
    script: 'src/discuss-server.ts',
    interpreter: 'node',
    interpreter_args: '--import tsx',
    cwd: __dirname,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    env: {
      NODE_ENV: 'production',
      HARNESS_ENGINE: 'minimax',
      PORT: 3100,
    },
    error_file: '.pm2/logs/err.log',
    out_file: '.pm2/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};
