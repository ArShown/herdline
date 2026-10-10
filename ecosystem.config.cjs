// HERDLINE_PYTHON=/path/to/python3.11 pm2 start ecosystem.config.cjs && pm2 save
// pm2 starts at boot without your shell profile, so pin the interpreter and PATH here.
const home = process.env.HOME;

module.exports = {
  apps: [
    {
      name: 'herdline-bridge',
      cwd: __dirname + '/bridge',
      script: process.env.HERDLINE_PYTHON || 'python3',
      args: '-m herdline_bridge serve',
      interpreter: 'none',
      autorestart: true,
      env: {
        PATH: `${home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
      },
    },
  ],
};
