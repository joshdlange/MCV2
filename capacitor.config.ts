import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.marvelcardvault.app',
  appName: 'Marvel Card Vault',
  webDir: 'dist/public',
  server: {
    url: 'https://app.marvelcardvault.com',
    cleartext: false,
    androidScheme: 'https'
  },
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com']
    }
  }
};

export default config;
