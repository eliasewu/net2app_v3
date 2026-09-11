import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.net2app.gateway',
  appName: 'NET2APP Gateway',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_notification',
      iconColor: '#488AFF',
    },
    BackgroundRunner: {
      label: 'NET2APP Gateway Service',
      src: 'background.js',
      event: 'gatewayKeepalive',
      repeat: true,
      interval: 15,
      autoStart: true,
    },
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
