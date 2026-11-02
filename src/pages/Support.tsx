import { InfoPage, Section, EmailLink } from '@/components/info/InfoPage';

const Support = () => (
  <InfoPage title="Lung Sim Pro — Support">
    <Section title="Contact">
      <p>For help, feedback or to report a problem, email <EmailLink />.</p>
    </Section>

    <Section title="Reporting a problem">
      <p>To help us look into it, please include:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>The app version (shown on the app’s App Store page or in iPhone/iPad Settings).</li>
        <li>Your device model (for example iPhone 15 or iPad Air) and iOS / iPadOS version.</li>
        <li>The patient, ventilator mode and settings you were using.</li>
        <li>The steps that led to the problem, what you expected, and what happened instead.</li>
        <li>A screenshot, if it helps.</li>
      </ul>
      <p className="text-foreground font-medium">
        Never send real patient information — no names, identifiers, records or clinical images.
      </p>
    </Section>

    <Section title="Educational use only">
      <p>
        Lung Sim Pro is a teaching simulator for clinical education. All patients are simulated. It is not a
        medical device, must not be used for real patient care or clinical decisions, and is not a substitute
        for formal ventilator training or local clinical guidance.
      </p>
    </Section>
  </InfoPage>
);

export default Support;
