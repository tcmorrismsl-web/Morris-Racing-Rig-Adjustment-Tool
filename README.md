# Morris Racing

A phone-friendly companion for racing on Xbox with a MOZA R3 and ESX wheel. It tells you what to change when you switch between **Forza Motorsport** and **F1 25**, and gives setup starting points for each game.

**Use it:** https://tcmorrismsl-web.github.io/Morris-Racing-Rig-Adjustment-Tool/

On a phone, use "Add to Home Screen" so it opens like an app.

## What it does

- **Wheel**: the MOZA Racing app and in-game wheel settings for each game. When you switch games, it shows a short checklist of only what changes (preset first, then steering angle).
- **Setup**:
  - *Forza Motorsport*: a tune for any track, class (E to X), drivetrain, weather, time of day, temperature and race length. Pressures, alignment, anti-roll bars, damping, brakes and diff are given as slider values. Springs, ride height, aero and gearing are given as changes from the car's default tune, because Forza scales those per car.
  - *F1 25*: full setup-screen values for the 2025 cars and the 2026 Season Pack cars, for quali or race, dry or wet, and a stable, balanced or aggressive feel.
- **Fix it**: step-by-step fixes for understeer, oversteer, bumps, lock-ups and more. Forza fixes follow your drivetrain.
- **Saved**: keep tunes and setups you like. They are stored in your browser on that device only.

## Accuracy

Everything here is a rule-based starting point built from published MOZA, Turn 10 and community guidance. It is not a guaranteed fastest setup. Make one change at a time and drive a lap between changes. The 2026 car values are estimates, since the Season Pack is newer.

## Changing the data

- Tracks, wheel settings and F1 ranges: `js/data.js`
- Forza tuning rules and fixes: `js/forza.js`
- F1 setup rules and fixes: `js/f1.js`

Run `npm test` to check every track, class and condition combination still produces in-range values.

## Run locally

Any static file server works, for example `npm start`, then open the address it prints.
