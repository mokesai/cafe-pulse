module.exports = {
  apps: [
    {
      name: 'cafe-server',
      script: 'npm',
      args: 'start',
      cwd: '/home/pi/cafe-web',
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'kds-drinks',
      script: './kiosk.sh',
      args: 'drinks wps',
      cwd: '/home/pi/cafe-web',
      autorestart: true,
      restart_delay: 15000,
      env: {
        DISPLAY: ':0',
      },
    },
    {
      name: 'kds-food',
      script: './kiosk.sh',
      args: 'food wps',
      cwd: '/home/pi/cafe-web',
      autorestart: true,
      restart_delay: 15000,
      env: {
        DISPLAY: ':1',
      },
    },
  ],
}
