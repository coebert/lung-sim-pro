import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.a148f60eaf3c442b9a0271a7e258d43a',
  appName: 'lung-sim-pro',
  webDir: 'dist',
  // Hot-reload from the Lovable sandbox for device testing.
  // REMOVE this `server` block before building for App Store submission,
  // so the app runs fully offline from its bundled files.
  server: {
    url: 'https://a148f60e-af3c-442b-9a02-71a7e258d43a.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
};

export default config;
