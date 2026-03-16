import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.marvelcardvault.app',
  appName: 'Marvelous Card Vault',
  webDir: 'dist/public',
  server: {
    url: 'https://app.marvelcardvault.com',
    cleartext: false,
    androidScheme: 'https'
  },
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com', 'apple.com']
    },
    SocialLogin: {
      google: {
        webClientId: '946426423073-rjhk84sgojd77gvkq2uf5ehrcd1l3ja9.apps.googleusercontent.com'
      }
    },
    App: {
      launchUrl: 'marvelcardvault://'
    }
  }
};

export default config;
