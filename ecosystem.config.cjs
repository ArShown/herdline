// pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'herdline-bridge',
      cwd: __dirname + '/bridge',
      script: 'python3',
      args: '-m herdline_bridge serve',
      interpreter: 'none',
      autorestart: true,
    },
  ],
};
