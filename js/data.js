// Reference data for Morris Racing.
// Everything here is a starting point to tune from, not a guaranteed fastest setup.

// ---------------------------------------------------------------------------
// Wheel (MOZA R3 + ESX) profiles per game
// ---------------------------------------------------------------------------
export const WHEEL_PROFILES = {
  forza: {
    name: 'Forza Motorsport',
    moza: [
      // Basic
      { group: 'Basic', key: 'preset', label: 'Preset', value: 'GT', why: 'There is no Forza preset. GT is the closest for circuit cars. Pick it first, because a preset overwrites everything below.' },
      { group: 'Basic', key: 'angle', label: 'Max steering angle', value: '2000°', why: 'MOZA\'s Xbox list says Forza Motorsport needs 2000°. Forza reads it when you run Calibrate Steering, then sets each car\'s own lock.' },
      { group: 'Basic', key: 'ffb', label: 'Game FFB intensity', value: '100%', why: 'The R3 is a light base, so never lower this. Adjust strength in the game.' },
      { group: 'Basic', key: 'road', label: 'Road sensitivity', value: '8', why: 'Enough surface detail to feel the road without the wheel buzzing in your hands.' },
      { group: 'Basic', key: 'speed', label: 'Max wheel speed', value: '100%', why: 'Lets the wheel snap back as fast as the tyres ask. Lower it only if the wheel whips on slides.' },
      { group: 'Basic', key: 'spring', label: 'Wheel spring strength', value: '0%', why: 'A fake centring spring. Forza makes its own centring from the tyres.' },
      { group: 'Basic', key: 'damping', label: 'Natural damping (wheel damper)', value: '45%', why: 'Steadies the wheel so it doesn\'t snap or wobble. Raise 5 if it still feels twitchy; lower 5 if it feels like stirring syrup.' },
      { group: 'Basic', key: 'filter', label: 'Game force filtering', value: 'Preset default', why: 'Smooths the signal. Leave it; changing it also resets the equalizer.' },
      { group: 'Basic', key: 'reverse', label: 'FFB reversal', value: 'Off' },
      // Advanced
      { group: 'Advanced', key: 'torque', label: 'Max output torque limit', value: '100%', why: 'The R3 is 3.9 Nm, so there is nothing to cap.' },
      { group: 'Advanced', key: 'friction', label: 'Natural friction', value: '20%', why: 'A little constant weight, like a real steering rack, so small movements don\'t upset the car.' },
      { group: 'Advanced', key: 'inertia', label: 'Natural inertia', value: '150%', why: 'Gives the wheel some heft so it feels like a car, not a toy.' },
      { group: 'Advanced', key: 'sdd', label: 'Speed-dependent damping', value: '40% from 100 km/h', why: 'Extra calm at high speed, where small inputs matter most, while slow corners stay light.' },
      { group: 'Advanced', key: 'softStiff', label: 'Soft limit stiffness', value: 'Preset default', why: 'Only matters at full 2000° lock, which you never reach.' },
      { group: 'Advanced', key: 'softStrength', label: 'Soft limit strength', value: 'Preset default' },
      { group: 'Advanced', key: 'softGame', label: 'Soft limit game force', value: 'Off' },
      // Equalizer
      { group: 'FFB equalizer', key: 'eq', label: 'FFB equalizer (10 / 15 / 25 / 40 / 50 Hz)', value: 'Preset default', why: 'Leave the GT preset\'s curve. If your phone app doesn\'t show it, it\'s Pit House only anyway.' },
      // Safety
      { group: 'Safety', key: 'handsoff', label: 'Hands-off protection', value: 'On' },
      { group: 'Safety', key: 'aux', label: 'Auxiliary centering control', value: 'On', why: 'Stops the wheel oscillating if you let go.' },
    ],
    game: {
      groups: [
        {
          where: 'Settings, then Driving Assists',
          items: [
            { label: 'Steering', value: 'Normal', why: 'Smooths your inputs and stops you turning more than the tyres can take. Turn in smoothly rather than snapping the wheel, and it rewards you.' },
            { label: 'Stability control', value: 'On', why: 'Catches slides early and keeps the car pointed where you\'re steering. If the car feels like it won\'t rotate into tight corners, try Sport.' },
            { label: 'Traction control', value: 'Sport', why: 'Stops wheelspin out of slow corners without killing the drive.' },
            { label: 'ABS', value: 'On', why: 'Brake hard without locking up. Most of the field races with it on.' },
          ],
        },
        {
          where: 'Settings, then Advanced Input',
          items: [
            { label: 'Calibrate Steering', value: 'Run it after setting 2000° on the base', why: 'Forza reads the base\'s rotation here. If it shows 900, the base was on 900 when you calibrated: set 2000 in the MOZA app and calibrate again.' },
            { label: 'Steering axis deadzone inside', value: '0', why: 'No dead spot in the middle of the wheel.' },
            { label: 'Steering axis deadzone outside', value: '100', why: 'Uses the full rotation.' },
            { label: 'Steering axis invert', value: 'Off' },
            { label: 'Invert force feedback', value: 'Off' },
            { label: 'Vibration scale', value: '30', why: 'A rumble when the tyres lose grip. A useful warning without shaking your hands.' },
            { label: 'Force feedback scale', value: '90', why: 'Overall strength. Raise it if the wheel feels light; lower it if it goes flat and dead in fast corners.' },
            { label: 'Self steering alignment', value: '90', why: 'Pulls the wheel back to centre out of corners. Too high feels jerky and snaps the wheel.' },
            { label: 'Mechanical trail scale', value: '100', why: 'Steering weight. Raise 10 at a time if the wheel feels light.' },
            { label: 'Pneumatic trail scale', value: '80', why: 'The wheel goes lighter as the front tyres start to slide, so you feel understeer coming. Raise it if you can\'t feel that.' },
            { label: 'Road feel scale', value: '70', why: 'Bumps and kerbs. Lower it if the wheel gets busy.' },
            { label: 'Load sensitivity', value: '50', why: 'Adds weight as the tyres load up in faster corners.' },
            { label: 'Wheel damper scale', value: '25', why: 'Keeps the wheel steady on straights and stops it whipping out of corners.' },
            { label: 'Center spring scale', value: '0', why: 'A fake spring not linked to the tyres. If the wheel still feels springy at 0, set it to 1, apply, then back to 0 and apply: a known bug can leave it on.' },
            { label: 'Dynamic damper behavior', value: '40', why: 'Calms the kick from kerbs and contact.' },
            { label: 'Steering sensitivity', value: '50', why: 'Default, so the wheel and front wheels move 1:1.' },
            { label: 'Steering linearity', value: '50', why: '50 is linear, which Turn 10 recommends for wheels.' },
            { label: 'Use gamepad steering filters', value: 'Off' },
            { label: 'Throttle and brake deadzones', value: 'Inside 0, outside 100', why: 'Calibrate the pedals in the MOZA app first, then leave these at full range.' },
          ],
        },
        {
          where: 'In each car\'s tuning menu',
          items: [
            { label: 'Force feedback scale (per car)', value: 'Start at default; raise if that car feels light', why: 'Separate from the global setting and not saved with the tune. If one car feels light and others don\'t, this is why.' },
          ],
        },
      ],
      after: 'Set up to feel like a real car but stay easy to drive with Normal steering and stability control on. Too light: raise force feedback scale, then mechanical trail. Too twitchy: raise wheel damper scale 5 at a time. Change one thing, drive a lap, then the next.',
    },
  },
  f1: {
    name: 'F1 25',
    moza: [
      { group: 'Basic', key: 'preset', label: 'Preset', value: 'Formula 1', why: 'Pick it first, because a preset overwrites everything below.' },
      { group: 'Basic', key: 'angle', label: 'Max steering angle', value: '380° (synchronous on)', why: 'Matches F1 25\'s wheel rotation of 380°. From MOZA\'s R3 guide.' },
      { group: 'Basic', key: 'ffb', label: 'Game FFB intensity', value: '100%', why: 'Tune strength in the game instead.' },
      { group: 'Basic', key: 'road', label: 'Road sensitivity', value: '7', why: 'A bit lower than Forza, because F1 25 already sends plenty of kerb and surface detail.' },
      { group: 'Basic', key: 'speed', label: 'Max wheel speed', value: '50%', why: 'From MOZA\'s R3 guide for F1.' },
      { group: 'Basic', key: 'spring', label: 'Wheel spring strength', value: '0%' },
      { group: 'Basic', key: 'damping', label: 'Natural damping (wheel damper)', value: '45%', why: 'From MOZA\'s R3 guide for F1. Raise slightly if the wheel shakes under heavy braking.' },
      { group: 'Basic', key: 'filter', label: 'Game force filtering', value: 'Preset default' },
      { group: 'Basic', key: 'reverse', label: 'FFB reversal', value: 'Off' },
      { group: 'Advanced', key: 'torque', label: 'Max output torque limit', value: '100%', why: 'The R3 is 3.9 Nm, so there is nothing to cap.' },
      { group: 'Advanced', key: 'friction', label: 'Natural friction', value: '30%', why: 'Adds the weight of an F1 steering rack.' },
      { group: 'Advanced', key: 'inertia', label: 'Natural inertia', value: '200%', why: 'Lower it if the wheel oscillates under braking.' },
      { group: 'Advanced', key: 'sdd', label: 'Speed-dependent damping', value: '65% from 200 km/h' },
      { group: 'Advanced', key: 'softStiff', label: 'Soft limit stiffness', value: 'Preset default' },
      { group: 'Advanced', key: 'softStrength', label: 'Soft limit strength', value: 'Middle' },
      { group: 'Advanced', key: 'softGame', label: 'Soft limit game force', value: 'Off' },
      { group: 'FFB equalizer', key: 'eq', label: 'FFB equalizer (10 / 15 / 25 / 40 / 50 Hz)', value: '80 / 120 / 170 / 180 / 160%', why: 'From MOZA\'s guide for F1. If your phone app doesn\'t show it, set it once in Pit House; it stays on the base.' },
      { group: 'Safety', key: 'handsoff', label: 'Hands-off protection', value: 'On' },
      { group: 'Safety', key: 'aux', label: 'Auxiliary centering control', value: 'On' },
    ],
    game: {
      groups: [
        {
          where: 'Options, then Controller & Vibration Settings, then Force Feedback',
          items: [
            { label: 'Vibration & FFB', value: 'On' },
            { label: 'Vibration & FFB strength', value: '100%' },
            { label: 'On track effects', value: '45%' },
            { label: 'Rumble strip effects', value: '40%' },
            { label: 'Off track effects', value: '30%' },
            { label: 'Wheel damper', value: '30%' },
            { label: 'Wheel rotation', value: '380°' },
          ],
        },
        {
          where: 'Options, then Controller & Vibration Settings, then Calibration',
          items: [
            { label: 'Steering deadzone', value: '0' },
            { label: 'Steering linearity', value: '0', why: 'Linear, so the car turns exactly as much as the wheel.' },
            { label: 'Steering saturation', value: '0' },
            { label: 'Throttle and brake deadzone / saturation', value: '0', why: 'Calibrate the pedals in the MOZA app first.' },
          ],
        },
      ],
      after: 'The same values work for both the 2025 cars and the 2026 Season Pack cars.',
    },
  },
};

// When to use the phone app and when to use Pit House on the PC.
export const APP_GUIDE = {
  phone: [
    'Switching between Forza and F1: preset, steering angle and the other base settings on this page.',
    'Force feedback tweaks between races.',
    'Pedal calibration if the throttle or brake reads wrong.',
  ],
  pc: [
    'Firmware updates for the base, wheel and pedals.',
    'Settings the phone app doesn\'t show, such as the FFB equalizer and FFB curve. Set them once and they stay saved on the base.',
  ],
  steps: [
    'Unplug the base\'s USB cable from the Xbox and plug it into the laptop.',
    'Hold S1 and S2 on the wheel for 5 seconds to switch to PC mode. The base restarts, and the RPM lights breathe red, yellow and green.',
    'Open Pit House and make your changes or run the update. Don\'t unplug anything until an update finishes.',
    'Hold S1 and S2 for 5 seconds again to switch back to Xbox mode. The RPM lights sweep from the sides to the centre.',
    'Plug the USB cable back into the Xbox.',
  ],
};

export const SWITCH_TIPS = [
  'Change the preset first, then the steering angle. Picking a preset after the angle resets it.',
  'Make the changes in the MOZA Racing app on your phone before starting the game. The base can stay plugged into the Xbox.',
  'If there is no force feedback when you get on track, press the Xbox button, go to the Home screen and back, or restart the game. The game lost focus on the wheel.',
  'If menus scroll by themselves, recalibrate the pedals in the app to remove the dead zone.',
];

// ---------------------------------------------------------------------------
// Forza Motorsport (2023) tracks
// speed: 1 tight/slow ... 4 very fast. bumps/elev: 0 smooth/flat ... 2 very.
// straight: 1 short ... 4 very long. brakes: 1 light ... 3 heavy zones.
// ---------------------------------------------------------------------------
export const FORZA_TRACKS = [
  { id: 'barcelona', name: 'Barcelona-Catalunya', speed: 2, bumps: 0, elev: 1, straight: 3, brakes: 2, straightName: 'the main straight into Turn 1', note: 'The final sector is all about traction, so a smooth exit beats a fast entry.' },
  { id: 'daytona', name: 'Daytona Road Course', speed: 4, bumps: 1, elev: 1, straight: 4, brakes: 3, straightName: 'the banking before the Bus Stop', note: 'Most of the lap is flat out on the banking. Gear for top speed and keep the car stable through the infield.' },
  { id: 'eaglerock', name: 'Eaglerock Speedway', speed: 2, bumps: 0, elev: 0, straight: 2, brakes: 2, straightName: 'the main straight', note: 'Fictional circuit with flowing medium-speed corners. A balanced tune works well.' },
  { id: 'fujimi', name: 'Fujimi Kaido Full Circuit', speed: 1, bumps: 2, elev: 2, straight: 1, brakes: 2, straightName: 'the longest downhill run', note: 'About 10.2 miles, 144 corners and an 826 m summit. Soft, compliant and short-geared. Expect long races.' },
  { id: 'grandoak', name: 'Grand Oak Raceway', speed: 3, bumps: 1, elev: 1, straight: 3, brakes: 2, straightName: 'the back straight', note: 'Fast and sweeping with some elevation. Favour stability at speed.' },
  { id: 'hakone', name: 'Hakone Circuit', speed: 2, bumps: 0, elev: 1, straight: 3, brakes: 2, straightName: 'the main straight', note: 'Fictional Japanese circuit with a mix of fast and technical sections.' },
  { id: 'hockenheim', name: 'Hockenheimring', speed: 2, bumps: 0, elev: 0, straight: 3, brakes: 3, straightName: 'the Parabolika into the hairpin', note: 'Big braking into the hairpin after the Parabolika. Stable under braking matters.' },
  { id: 'homestead', name: 'Homestead-Miami Road Course', speed: 2, bumps: 0, elev: 0, straight: 3, brakes: 2, straightName: 'the oval banking section', note: 'Mix of oval banking and a tight infield.' },
  { id: 'indy', name: 'Indianapolis GP', speed: 2, bumps: 0, elev: 0, straight: 4, brakes: 3, straightName: 'the front straight into Turn 1', note: 'Long front straight then a heavy stop into Turn 1. Tight infield.' },
  { id: 'kyalami', name: 'Kyalami', speed: 3, bumps: 0, elev: 2, straight: 3, brakes: 2, straightName: 'the main straight', note: 'Lots of elevation change and fast flowing corners.' },
  { id: 'laguna', name: 'Laguna Seca', speed: 2, bumps: 1, elev: 2, straight: 2, brakes: 2, straightName: 'the front straight', note: 'Short lap with the Corkscrew drop. Needs a car that stays settled over crests.' },
  { id: 'lemans', name: 'Le Mans (Circuit de la Sarthe)', speed: 4, bumps: 1, elev: 0, straight: 4, brakes: 3, straightName: 'the Mulsanne Straight', note: 'Very long straights and big stops. Low drag and long gears, but keep enough rear stability for the Porsche Curves.' },
  { id: 'limerock', name: 'Lime Rock Park', speed: 3, bumps: 1, elev: 1, straight: 2, brakes: 1, straightName: 'the front straight', note: 'Very short, fast lap with little braking. Momentum and mid-corner grip matter most.' },
  { id: 'maple', name: 'Maple Valley', speed: 2, bumps: 1, elev: 1, straight: 2, brakes: 2, straightName: 'the main straight', note: 'Fictional circuit with flowing corners and some elevation.' },
  { id: 'midohio', name: 'Mid-Ohio', speed: 2, bumps: 1, elev: 1, straight: 3, brakes: 2, straightName: 'the back straight into the Keyhole', note: 'Technical with elevation. Good traction out of the Keyhole sets up the long straight.' },
  { id: 'bathurst', name: 'Mount Panorama (Bathurst)', speed: 3, bumps: 1, elev: 2, straight: 4, brakes: 3, straightName: 'Conrod Straight into The Chase', note: 'About 3.86 miles with roughly 174 m of climb. Narrow and walled across the Mountain, so you need a car that stays settled over the crests and under braking into Forrest\'s Elbow. Gear for Conrod Straight.' },
  { id: 'mugello', name: 'Mugello', speed: 3, bumps: 0, elev: 2, straight: 4, brakes: 3, straightName: 'the main straight into San Donato', note: 'Fast, flowing and hilly with a long main straight.' },
  { id: 'nurgp', name: 'Nürburgring GP', speed: 2, bumps: 0, elev: 1, straight: 3, brakes: 2, straightName: 'the back straight to the chicane', note: 'Medium-speed modern circuit.' },
  { id: 'nords', name: 'Nürburgring Nordschleife', speed: 3, bumps: 2, elev: 2, straight: 4, brakes: 2, straightName: 'Döttinger Höhe', note: 'About 12.9 miles of crests, jumps and compressions. Raise the car and soften it so it lands cleanly, but gear for Döttinger Höhe.' },
  { id: 'roadamerica', name: 'Road America', speed: 3, bumps: 1, elev: 1, straight: 4, brakes: 3, straightName: 'the front straight and Moraine Sweep', note: 'Long straights and heavy stops. Low drag pays off.' },
  { id: 'roadatlanta', name: 'Road Atlanta', speed: 3, bumps: 1, elev: 2, straight: 3, brakes: 2, straightName: 'the back straight down to Turn 10', note: 'Fast and hilly. The uphill Esses need quick direction changes, and the blind drop under the bridge at Turn 12 needs a car that stays stable over the crest.' },
  { id: 'sebring', name: 'Sebring', speed: 2, bumps: 2, elev: 0, straight: 3, brakes: 3, straightName: 'the Ulmann Straight', note: 'Famously bumpy concrete. Soft damping and extra ride height keep the car on the ground.' },
  { id: 'silverstone', name: 'Silverstone', speed: 3, bumps: 0, elev: 0, straight: 3, brakes: 2, straightName: 'the Hangar Straight', note: 'Fast direction changes through Maggotts and Becketts reward a stable, responsive car.' },
  { id: 'spa', name: 'Spa-Francorchamps', speed: 3, bumps: 0, elev: 2, straight: 4, brakes: 2, straightName: 'the Kemmel Straight', note: 'Older pre-2022 layout. Fast with big elevation. Low drag for Kemmel but keep grip for Pouhon.' },
  { id: 'sunset', name: 'Sunset Peninsula (road layouts)', speed: 2, bumps: 0, elev: 0, straight: 2, brakes: 2, straightName: 'the main straight', note: 'Turn 10 original with Full and Club layouts.' },
  { id: 'sunsetoval', name: 'Sunset Peninsula Speedway', speed: 4, bumps: 0, elev: 0, straight: 4, brakes: 1, straightName: 'the oval', note: 'Oval layout. Mostly flat out, so drag and gearing decide it.' },
  { id: 'suzuka', name: 'Suzuka', speed: 3, bumps: 0, elev: 1, straight: 3, brakes: 2, straightName: 'the back straight through 130R', note: 'The Esses need a car that changes direction quickly.' },
  { id: 'vir', name: 'Virginia International Raceway', speed: 3, bumps: 1, elev: 2, straight: 3, brakes: 2, straightName: 'the back straight', note: 'Fast, flowing and hilly through the Climbing Esses.' },
  { id: 'watkins', name: 'Watkins Glen', speed: 3, bumps: 1, elev: 1, straight: 3, brakes: 2, straightName: 'the back straight', note: 'Fast and kerb-heavy through the Bus Stop.' },
  { id: 'yas', name: 'Yas Marina', speed: 2, bumps: 0, elev: 0, straight: 4, brakes: 3, straightName: 'the long back straight', note: 'Long straights into tight hairpins. Braking stability and traction matter most.' },
];

export const FORZA_CLASSES = [
  { id: 'E', label: 'E', range: '100–300', tier: 0 },
  { id: 'D', label: 'D', range: '301–400', tier: 0 },
  { id: 'C', label: 'C', range: '401–500', tier: 1 },
  { id: 'B', label: 'B', range: '501–600', tier: 1 },
  { id: 'A', label: 'A', range: '601–700', tier: 2 },
  { id: 'S', label: 'S', range: '701–800', tier: 2 },
  { id: 'R', label: 'R', range: '801–900', tier: 3 },
  { id: 'P', label: 'P', range: '901–998', tier: 3 },
  { id: 'X', label: 'X', range: '999', tier: 3 },
];

// ---------------------------------------------------------------------------
// F1 25 tracks
// df: downforce need 1 (Monza) ... 5 (Monaco). bumps 0-2. traction 0-2 (slow-corner exits).
// kerbs 0-2 (how much kerb riding is needed).
// ---------------------------------------------------------------------------
export const F1_TRACKS = [
  { id: 'australia', name: 'Australia (Melbourne)', df: 3, bumps: 1, traction: 1, kerbs: 1 },
  { id: 'china', name: 'China (Shanghai)', df: 3, bumps: 0, traction: 1, kerbs: 0 },
  { id: 'japan', name: 'Japan (Suzuka)', df: 4, bumps: 0, traction: 0, kerbs: 1 },
  { id: 'bahrain', name: 'Bahrain (Sakhir)', df: 3, bumps: 0, traction: 2, kerbs: 0 },
  { id: 'saudi', name: 'Saudi Arabia (Jeddah)', df: 2, bumps: 0, traction: 0, kerbs: 1 },
  { id: 'miami', name: 'Miami', df: 3, bumps: 1, traction: 1, kerbs: 0 },
  { id: 'imola', name: 'Emilia-Romagna (Imola)', df: 4, bumps: 1, traction: 1, kerbs: 2, only: 2025 },
  { id: 'monaco', name: 'Monaco', df: 5, bumps: 2, traction: 2, kerbs: 0 },
  { id: 'spain', name: 'Spain (Barcelona)', df: 4, bumps: 0, traction: 1, kerbs: 1 },
  { id: 'canada', name: 'Canada (Montréal)', df: 2, bumps: 1, traction: 2, kerbs: 2 },
  { id: 'austria', name: 'Austria (Red Bull Ring)', df: 3, bumps: 0, traction: 1, kerbs: 2 },
  { id: 'britain', name: 'Britain (Silverstone)', df: 3, bumps: 0, traction: 0, kerbs: 0 },
  { id: 'belgium', name: 'Belgium (Spa)', df: 2, bumps: 0, traction: 1, kerbs: 1 },
  { id: 'hungary', name: 'Hungary (Hungaroring)', df: 5, bumps: 0, traction: 1, kerbs: 1 },
  { id: 'netherlands', name: 'Netherlands (Zandvoort)', df: 5, bumps: 0, traction: 1, kerbs: 1 },
  { id: 'italy', name: 'Italy (Monza)', df: 1, bumps: 0, traction: 1, kerbs: 2 },
  { id: 'madring', name: 'Spain (Madring, Madrid)', df: 4, bumps: 1, traction: 2, kerbs: 1, only: 2026 },
  { id: 'baku', name: 'Azerbaijan (Baku)', df: 2, bumps: 1, traction: 2, kerbs: 0 },
  { id: 'singapore', name: 'Singapore', df: 5, bumps: 2, traction: 2, kerbs: 2 },
  { id: 'usa', name: 'USA (Austin)', df: 4, bumps: 2, traction: 1, kerbs: 1 },
  { id: 'mexico', name: 'Mexico City', df: 3, bumps: 1, traction: 1, kerbs: 1 },
  { id: 'brazil', name: 'Brazil (Interlagos)', df: 3, bumps: 1, traction: 1, kerbs: 1 },
  { id: 'vegas', name: 'Las Vegas', df: 1, bumps: 1, traction: 2, kerbs: 0 },
  { id: 'qatar', name: 'Qatar (Lusail)', df: 4, bumps: 0, traction: 0, kerbs: 2 },
  { id: 'abudhabi', name: 'Abu Dhabi (Yas Marina)', df: 3, bumps: 0, traction: 2, kerbs: 0 },
];

// In-game setup ranges (F1 25 and the 2026 Season Pack share the same setup screen).
export const F1_RANGES = {
  frontWing: [0, 50], rearWing: [0, 50],
  diffOn: [10, 100], diffOff: [10, 100],
  frontCamber: [-3.5, -2.5], rearCamber: [-2.0, -1.0],
  frontToe: [0.0, 0.5], rearToe: [0.1, 0.5],
  frontSusp: [1, 41], rearSusp: [1, 41],
  frontArb: [1, 21], rearArb: [1, 21],
  frontRide: [15, 35], rearRide: [40, 60],
  brakePressure: [80, 100], brakeBias: [50, 70],
  frontTyre: [22.5, 29.5], rearTyre: [20.5, 26.5],
};
