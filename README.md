# Morris Racing

A phone-friendly companion for racing on Xbox with a MOZA R3 and ESX wheel. It tells you what to change when you switch between **Forza Motorsport** and **F1 25**, and gives setup starting points for each game.

**Use it:** https://tcmorrismsl-web.github.io/Morris-Racing-Rig-Adjustment-Tool/

On a phone, use "Add to Home Screen" so it opens like an app.

## What it does

- **Wheel**: the MOZA Racing app and in-game wheel settings for each game. When you switch games, it shows a short checklist of only what changes (preset first, then steering angle).
- **Setup**:
  - *Forza Motorsport*: a tune for any track, class (E to X), drivetrain, weather, race start time, temperature, number of laps (turned into an estimated race length) and tyre compound (Soft, Medium, Hard or Wet, with a suggestion for the race). Pressures, alignment, anti-roll bars, damping, brakes and diff are given as slider values. Springs, ride height, aero and gearing are given as changes from the car's default tune, because Forza scales those per car. Suspension geometry (roll center and anti-geometry) is included as small, late adjustments. Turn on "Enter my current values" to type in what the car has now and see exactly what to change each setting to; values are saved per garage car.
  - *F1 25*: full setup-screen values for the 2025 cars and the 2026 Season Pack cars, for quali or race, dry or wet, and a stable, balanced or aggressive feel. Races take a distance (5 laps, 25%, 35%, 50%, 100% or any lap count) and a starting tyre (Soft, Medium, Hard, Inter, Wet); shorter races run closer to a quali setup, longer ones protect the tyres, and you get a tyre strategy for the distance.
- **Garage** (Forza): pick from all 552 Forza Motorsport cars (the 499-car launch roster by division from Turn 10's official list, plus DLC, Car Pass and Update 20 cars; type any name for cars from other updates). Track the cars you own with their PI, class, stats, power, weight and fitted tuning parts. Updating a car logs what changed in its upgrade history. Pick a garage car on the Setup tab and the tune uses its class and drivetrain, and flags settings it can't adjust until you fit the parts. Back up and restore the garage as a file to move it between devices.
- **Fix it**: step-by-step fixes for understeer, oversteer, bumps, lock-ups and more. Forza fixes follow your drivetrain.
- **Data**: live telemetry from the Xbox. After a few laps it turns what the car is doing (understeer or oversteer by corner phase, wheelspin, lock-ups, bottoming out, tyre temperatures and wear) into specific setting changes, and keeps a lap log with the car, track and tune you used. Needs the bridge below.
- **In use now** (F1 25, Data tab, needs the bridge): the track, session, race laps, weather, tyre and the full setup on your car are read straight from the game. Each setting shows whether it matches the app's suggestion and by how much to change it, one tap fills the Setup tab from the game, and every lap is logged with the setup and tyre in use.
- **Race dashboard** (Data tab, needs the bridge): a live screen for a tablet or a phone turned sideways.
  - *F1 25*: track map with every car, timing tower (interval or gap to leader, last lap, tyre and age, pit and penalty flags), the game's own pit window and predicted rejoin position, the tyre sets you can fit and whether they reach the end, fuel from the MFD, rain warnings, and on-track changes (brake bias, on-throttle diff, tyre temperatures, ERS) worked out from the last minute of driving.
  - *Forza Motorsport*: Forza only sends your own car, so the dashboard shows the track map, position, lap timing with a live delta to your best lap, fuel and tyre-wear estimates for the race distance set on the Setup tab, and driving tips. Forza has no in-car setup changes.
  - Track maps are drawn as cars drive the first lap and saved on the laptop, so they appear straight away next time.
  - *Adjustments* follow where you are: on track, only what you can change from the wheel (brake bias, on-throttle diff, ERS); in the garage, setup changes from your laps this session; at a race pit stop, front wing only. Tyre temperatures are left out.
  - *Race engineer*: a voice on the radio (the device's own female voice, flirty and smooth or straight to the point). F1: race splits and gap trends each lap, DRS/defend alerts, position changes, the game's pit window with a box-or-stay question, safety car, flags, penalties, fuel, tyre wear, rain warnings and weather changes, where you're losing time (compared with the car ahead in a race or the fastest lap in qualifying, shown on the map) with how to fix it, and in qualifying when to leave the garage for a gap in traffic and the latest time to leave for a final lap. Forza: lap times, position changes, where you lost time against your best lap, and fuel and tyre warnings.
  - *Voice*: Fiery and flirty (default: upbeat, says numbers the way an engineer would, keeps a playful tab of your mistakes as a reminder of what a clean drive earns), Smooth and sultry, or Straight. A radio click plays before each call. The best-sounding voices are Edge's "Natural" voices on a laptop and Enhanced/Premium voices on iPhone.
  - *Talk back*: tap Gaps, Pit, Losing time, Weather, Tyres & fuel, Repeat, or Yes/No when she asks something. In F1 25, bind UDP Action 1–8 to wheel buttons (1 Yes, 2 No, 3 Gaps, 4 Pit, 5 Losing time, 6 Weather, 7 Tyres & fuel, 8 Repeat) and answer from the wheel. Spoken replies work where the browser allows the microphone (the laptop itself).
- **Saved**: keep tunes and setups you like. They are stored in your browser on that device only.

## Live data (telemetry)

The Xbox sends telemetry over your home network, which a phone browser can't receive, so a small bridge program runs on a Windows laptop on the same Wi-Fi.

1. Install [Node.js](https://nodejs.org/en/download) (LTS) on the laptop, first time only.
2. Download [MorrisRacingBridge.zip](https://github.com/tcmorrismsl-web/Morris-Racing-Rig-Adjustment-Tool/raw/main/dist/MorrisRacingBridge.zip), unzip it and double-click `Start Morris Racing Bridge.cmd`. The zip is plain code (no .exe), so antivirus has nothing to flag. Allow it on Private networks if asked.
3. Open the address it shows (for example `http://192.168.1.20:8080`) on your phone. Use that copy of the app while racing.
4. In the game:
   - **Forza Motorsport**: Settings, Gameplay & HUD, UDP Race Telemetry. Data Out On, IP = laptop address, port 5300, packet format Car Dash.
   - **F1 25**: Settings, Telemetry Settings. UDP Telemetry On, Broadcast Off, IP = laptop address, port 20777, send rate 60Hz, format 2025 or 2026.

Either port accepts either game. Laps are saved on the laptop in a `MorrisRacing` folder in your user folder, so nothing is lost if the phone screen locks.

To try it without an Xbox: `npm run bridge`, then `npm run simulate -- forza` (or `f1`, `f1-2026`) for laps, or `npm run simulate:race -- f1` (or `f1-2026`, `forza`) for a full live race on the dashboard.

## Updates

The bridge keeps the app and dashboard up to date by itself: every 30 minutes it checks the app's website and downloads newer app files, as long as they work with that bridge. Reload the page on your phone to get them. When a change needs new bridge code, the Data tab says a new bridge is available.

## Accuracy

Everything here is a rule-based starting point built from published MOZA, Turn 10 and community guidance. It is not a guaranteed fastest setup. Make one change at a time and drive a lap between changes. The 2026 car values are estimates, since the Season Pack is newer.

## Changing the data

- Tracks, wheel settings and F1 ranges: `js/data.js`
- Forza tuning rules and fixes: `js/forza.js`
- Garage: `js/garage.js`; Forza car list: `js/cars.js`
- Telemetry advice: `js/advice.js`; bridge and packet decoding: `bridge/`
- F1 setup rules and fixes: `js/f1.js`

Run `npm test` to check every track, class and condition combination still produces in-range values, and to run the telemetry decoding and bridge tests with simulated packets. `npm run build:bridge` rebuilds the bridge zip.

## Run locally

Any static file server works, for example `npm start`, then open the address it prints.
