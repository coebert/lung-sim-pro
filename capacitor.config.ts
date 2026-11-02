import type { CapacitorConfig } from '@capacitor/cli';

// Release default: the app runs from bundled `dist` assets, fully offline.
// Do NOT add a `server` block (url / cleartext) here — `npm run ios:check`
// rejects it. For live-reload device testing only, use a local, uncommitted
// override (see docs/IOS_RELEASE.md).
const config: CapacitorConfig = {
  // Existing ID, kept pending reconciliation with App Store Connect.
  appId: 'app.lovable.a148f60eaf3c442b9a0271a7e258d43a',
  appName: 'Lung Sim Pro',
  webDir: 'dist',
};

export default config;
