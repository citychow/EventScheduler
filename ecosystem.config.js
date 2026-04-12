module.exports = {
  apps: [
    {
      name:         'wembley-scheduler',
      script:       'scheduler.js',
      cron_restart: '0 14 * * 5',
      autorestart:  false,
      watch:        false,
    },
    {
      name:        'venue-monitor-server',
      script:      'server.js',
      autorestart: true,
      watch:       false,
    }
  ]
};