import { InfoPage, Section, EmailLink } from '@/components/info/InfoPage';

const Privacy = () => (
  <InfoPage title="Lung Sim Pro — Privacy Policy">
    <p className="text-xs">Last updated: 2 November 2026</p>

    <Section title="Summary">
      <p>
        Lung Sim Pro is an educational ventilator simulator. It has no user accounts, contains no advertising,
        and has no third-party analytics integrated. The simulator does not request patient records or
        device health data.
      </p>
    </Section>

    <Section title="What the app uses on your device">
      <ul className="list-disc pl-5 space-y-1">
        <li>
          <span className="text-foreground">Simulated case data.</span> All patients, physiology and readings are
          built into the app and generated on your device. They are not real people.
        </li>
        <li>
          <span className="text-foreground">Simulator and tutorial state.</span> Your chosen patient, ventilator
          settings, tutorial progress and scores are held in memory only while the app is running. They are not
          saved or sent anywhere.
        </li>
        <li>
          <span className="text-foreground">Onboarding preference.</span> A single local setting records that you
          have dismissed the welcome screen, so it isn’t shown every time. It stays on your device.
        </li>
      </ul>
    </Section>

    <Section title="iPhone and iPad app">
      <p>
        The App Store version runs from files bundled inside the app. Using the simulator does not send your
        simulator activity or the information above to us. Purchases are handled by Apple under Apple’s own
        privacy policy.
      </p>
    </Section>

    <Section title="Visiting the website">
      <p>
        If you open Lung Sim Pro in a web browser, the site is delivered by a third-party hosting provider
        (Lovable). As with any website, the hosting infrastructure may process standard connection information
        — such as your IP address, browser type and the pages requested — to deliver and secure the site. The
        website may also store app files in your browser so it can load faster or work offline.
      </p>
    </Section>

    <Section title="If you email support">
      <p>
        Emailing support is optional and is never done automatically by the simulator. If you contact us, we use
        your email address and the contents of your message to respond to your query, and we may keep
        correspondence where this is operationally necessary. Please do not include real patient information.
      </p>
    </Section>

    <Section title="Clearing data on your device">
      <p>
        Simulator and tutorial state is cleared when the app is fully restarted (or the browser page is reloaded); it can remain in memory while the app is in the background. To remove the stored onboarding
        preference, delete the app from your iPhone or iPad (iOS removes an app’s local data when it is deleted)
        or, on the website, clear the site’s data in your browser settings.
      </p>
    </Section>

    <Section title="Changes and contact">
      <p>
        If this policy changes, the date above will be updated. For privacy questions, email <EmailLink />.
      </p>
    </Section>
  </InfoPage>
);

export default Privacy;
