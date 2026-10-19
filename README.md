# Morris Racing

A phone-friendly companion for racing on Xbox with a MOZA R3 and ESX wheel. It tells you what to change when you switch between **Forza Motorsport** and **F1 25**, and gives setup starting points for each game.

**Use it:** https://tcmorrismsl-web.github.io/Morris-Racing-Rig-Adjustment-Tool/

On a phone, use "Add to Home Screen" so it opens like an app.

## What it does

- **Wheel**: the MOZA Racing app and in-game wheel settings for each game. When you switch games, it shows a short checklist of only what changes (preset first, then steering angle).
- **Setup**:
  - *Forza Motorsport*: a tune for any track, class (E to X), drivetrain, weather, time of day, temperature and race length. Pressures, alignment, anti-roll bars, damping, brakes and diff are given as slider values. Springs, ride height, aero and gearing are given as changes from the car's default tune, because Forza scales those per car.
  - *F1 25*: full setup-screen values for the 2025 cars and the 2026 Season Pack cars, for quali or race, dry or wet, and a stable, balanced or aggressive feel.
- **Garage** (Forza): the cars you own with their PI, class, stats, power, weight and fitted tuning parts. Updating a car logs what changed in its upgrade history. Pick a garage car on the Setup tab and the tune uses its class and drivetrain, and flags settings it can't adjust until you fit the parts. Back up and restore the garage as a file to move it between devices.
- **Fix it**: step-by-step fixes for understeer, oversteer, bumps, lock-ups and more. Forza fixes follow your drivetrain.
- **Data**: live telemetry from the Xbox. After a few laps it turns what the car is doing (understeer or oversteer by corner phase, wheelspin, lock-ups, bottoming out, tyre temperatures and wear) into specific setting changes, and keeps a lap log with the car, track and tune you used. Needs the bridge below.
- **Saved**: keep tunes and setups you like. They are stored in your browser on that device only.

## Live data (telemetry)

The Xbox sends telemetry over your home network, which a phone browser can't receive, so a small bridge program runs on a Windows laptop on the same Wi-Fi.

1. Download [MorrisRacingBridge.zip](https://github.com/tcmorrismsl-web/Morris-Racing-Rig-Adjustment-Tool/raw/main/dist/MorrisRacingBridge.zip) and unzip it.
2. Run `MorrisRacingBridge.exe`. Windows SmartScreen may warn because it is unsigned: choose More info, then Run anyway. Allow it on Private networks if asked.
3. Open the address it shows (for example `http://192.168.1.20:8080`) on your phone. Use that copy of the app while racing.
4. In the game:
   - **Forza Motorsport**: Settings, Gameplay & HUD, UDP Race Telemetry. Data Out On, IP = laptop address, port 5300, packet format Car Dash.
   - **F1 25**: Settings, Telemetry Settings. UDP Telemetry On, Broadcast Off, IP = laptop address, port 20777, send rate 60Hz, format 2025 or 2026.

Either port accepts either game. Laps are saved on the laptop in a `MorrisRacing` folder in your user folder, so nothing is lost if the phone screen locks.

To try it without an Xbox: `npm run bridge`, then `npm run simulate -- forza` (or `f1`, `f1-2026`).

## Accuracy

Everything here is a rule-based starting point built from published MOZA, Turn 10 and community guidance. It is not a guaranteed fastest setup. Make one change at a time and drive a lap between changes. The 2026 car values are estimates, since the Season Pack is newer.

## Changing the data

- Tracks, wheel settings and F1 ranges: `js/data.js`
- Forza tuning rules and fixes: `js/forza.js`
- Garage: `js/garage.js`
- Telemetry advice: `js/advice.js`; bridge and packet decoding: `bridge/`
- F1 setup rules and fixes: `js/f1.js`

Run `npm test` to check every track, class and condition combination still produces in-range values, and to run the telemetry decoding and bridge tests with simulated packets. `npm run build:bridge` rebuilds the Windows program.

## Run locally

Any static file server works, for example `npm start`, then open the address it prints.
