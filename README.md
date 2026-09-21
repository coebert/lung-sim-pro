# Vent Mastery

Please create a new app that will serve as a teaching aid for novice anaesthetists and intensive care doctors. The app should be a simulator which allows users to ventilate a simulated patient. The ventilator control screen should be based on the screen of a modern intensive care ventilator, such as those made by Maquet or Draeger, with pressure, flow and volume graphs. Users should be able to switch between different modes of ventilation, including VCV, PCV, PRVC, SIMV, PSV and APRV, and adjust all the settings associated with these modes. Users should be able to switch between ventilating a range of different patients, who will react differently depending on their physiology and underlying pathology. Patients should include: a healthy 70kg person, a morbidly obese person, a person with ARDS, a person with severe bronchospasm, a person with restrictive lung disease and a person who is breathing for themselves but with inadequate rate and tidal volumes. The app should display the patient’s monitoring screen including HR/3 lead ECG trace, invasive BP trace, sats trace and capnography. This monitoring should react in real time to changes in how the patient is ventilated, deteriorating if the ventilator settings are inappropriate and improving when these are optimised

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://lung-sim-pro.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a148f60e-af3c-442b-9a02-71a7e258d43a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
