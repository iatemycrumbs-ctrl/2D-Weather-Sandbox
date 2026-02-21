/*
This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. This program is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
details. You should have received a copy of the GNU General Public License along
with this program. If not, see <https://www.gnu.org/licenses/>.
*/


function getEl(id)
{
  return document.getElementById(id);
}

function readNumericInput(id, fallback)
{
  const el = getEl(id);
  if (!el || el.value == null)
    return fallback;
  const parsed = parseFloat(el.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function updateSetupSliders()
{
  let simResX = Math.round(readNumericInput('simResSelX', 512));
  let simResY = Math.round(readNumericInput('simResSelY', 300));
  let simHeight = Math.round(readNumericInput('simHeightSel', 12000));
  simHeight = clamp(simHeight, 4000, 22000);

  simResY = Math.max(simResY, 1);

  let cellHeight = simHeight / simResY;
  let simWidth = cellHeight * simResX;

  const simWorldProperties = getEl('simWorldProperties');
  if (simWorldProperties)
    simWorldProperties.innerHTML = 'cellHeight: ' + cellHeight.toFixed(1) + ' m  &nbsp&nbsp&nbsp   Simulation width: ' + (simWidth / 1000).toFixed(1) + ' km' + ' &nbsp&nbsp&nbsp Vertical levels: ' + simResY;

  const simHeightWarning = getEl('simHeightWarning');
  if (simHeightWarning)
    simHeightWarning.style.display = (simHeight == 12000) ? 'none' : 'block';

  const simResYWarning = getEl('simResYWarning');
  if (simResYWarning)
    simResYWarning.style.display = (simResY == 300) ? 'none' : 'block';

  const simResShowX = getEl('simResShowX');
  if (simResShowX)
    simResShowX.value = simResX;

  const simResShowY = getEl('simResShowY');
  if (simResShowY)
    simResShowY.value = simResY;

  const simHeightShow = getEl('simHeightShow');
  if (simHeightShow)
    simHeightShow.value = simHeight + ' m';

  const introDeviceInfo = getEl('introDeviceInfo');
  if (introDeviceInfo)
    introDeviceInfo.textContent = getDeviceInfoSummary();
}

var FPS = 60.0;


const VALID_DISPLAY_MODES = new Set([
  'DISP_TEMPERATURE', 'DISP_WATER', 'DISP_REAL', 'DISP_HORIVEL', 'DISP_VERTVEL',
  'DISP_IRHEATING', 'DISP_IRDOWNTEMP', 'DISP_IRUPTEMP', 'DISP_PRECIPFEEDBACK_MASS',
  'DISP_PRECIPFEEDBACK_HEAT', 'DISP_PRECIPFEEDBACK_VAPOR', 'DISP_PRECIPFEEDBACK_RAIN',
  'DISP_PRECIPFEEDBACK_SNOW', 'DISP_SOIL_MOISTURE', 'DISP_CURL', 'DISP_AIRQUALITY', 'DISP_RADAR'
]);

function sanitizeDisplayMode(mode)
{
  return VALID_DISPLAY_MODES.has(mode) ? mode : 'DISP_REAL';
}


function mixGeneric(a, b, t, {clamp = false} = {})
{
  const clampT = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  if (typeof a === 'number' && typeof b === 'number') {
    const tt = clamp ? clampT(t) : t;
    return a * (1 - tt) + b * tt;
  }

  // arrays / typed arrays
  if (Array.isArray(a) || ArrayBuffer.isView(a)) {
    if (!Array.isArray(b) && !ArrayBuffer.isView(b))
      throw new TypeError('mismatched types');
    if (a.length !== b.length)
      throw new RangeError('length mismatch');
    const out = new (Array.isArray(a) ? Array : a.constructor)(a.length);
    for (let i = 0; i < a.length; i++) {
      const tt = clamp ? clampT(t[i] ?? t) : (Array.isArray(t) ? t[i] ?? t : t);
      out[i] = a[i] * (1 - tt) + b[i] * tt;
    }
    return out;
  }

  // vector-like object with same keys
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out = {};
    for (const k of Object.keys(a)) {
      if (typeof a[k] === 'number' && typeof b[k] === 'number') {
        const tt = clamp ? clampT(t[k] ?? t) : (t && typeof t === 'object' ? (t[k] ?? t) : t);
        out[k] = a[k] * (1 - tt) + b[k] * tt;
      }
    }
    return out;
  }

  throw new TypeError('Unsupported types for mixGeneric');
}

const corsUrl = 'https://my-cors-proxy.nielsdaemen747.workers.dev/?url='; // my own proxy worker on cloudfare

async function getSoundingGraphImgUrl(url)
{
  try {
    const response = await fetch(corsUrl + encodeURIComponent(url));
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const img = doc.querySelectorAll('img')[0];
    return 'https://www.meteociel.fr/' + img.getAttribute('src');
  } catch (error) {
    console.error('Error fetching the data:', error);
  }
}

// Function to scrape table data from the given URL
async function scrapeTableData(url)
{
  try {
    const response = await fetch(corsUrl + encodeURIComponent(url));
    const html = await response.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Select the rows of the main table (starting at line 51)
    const rows = doc.querySelectorAll('table:nth-of-type(2) tr:not(:first-child)');

    const tableData = [];

    rows.forEach(row => {
      const cells = row.querySelectorAll('td');

      const rowData = {
        alt : parseFloat(cells[0].textContent),
        p : parseFloat(cells[1].textContent),
        t : parseFloat(cells[2].textContent),
        tw : parseFloat(cells[3].textContent),
        td : parseFloat(cells[4].textContent),
        rh : parseFloat(cells[5].textContent),
        vel : parseFloat(cells[6].textContent.split(' / ')[1]),
        angle : parseFloat(cells[6].textContent.split(' / ')[0]),
      };

      const hasNaN = Object.values(rowData).some(v => Number.isNaN(v));

      if (!hasNaN) // discard if the row contains any NaN
        tableData.push(rowData);
    });
    return tableData;

  } catch (error) {
    console.error('Error fetching the data:', error);
  }
}

async function loadSounding(stationID, timeStamp)
{

  const imgMapType = 1; // 0 = large classic emagram   1 = small emagram
  const graphPageUrl = 'https://www.meteociel.fr/cartes_obs/sondage_display.php?id=' + stationID + '&map=' + imgMapType + '&date=' + timeStamp;
  const tablePageUrl = 'https://www.meteociel.fr/cartes_obs/sondage_display.php?id=' + stationID + '&map=4&date=' + timeStamp;

  const SoundingGraphImgUrl = await getSoundingGraphImgUrl(graphPageUrl);

  const soundingImgEl = document.getElementById('soundingPreview');
  soundingImgEl.src = SoundingGraphImgUrl;

  // console.log(graphPageUrl, SoundingGraphImgUrl, tablePageUrl);

  return scrapeTableData(tablePageUrl);
}

function sampleIsInvalid(s) { return isNaN(s.t) || isNaN(s.td) || isNaN(s.vel); }

function rawSoundingToSimSounding(soundingData, simHeight, inSimSoundingRes)
{
  let soundingForSim = [];

  soundingDataIndex = soundingData.length - 1; // start from lowest datapoint

  for (let y = 0; y < inSimSoundingRes; y++) {

    const inSimAlt = y * (simHeight / sim_res_y);

    while (soundingData[soundingDataIndex]['alt'] < inSimAlt ||
           sampleIsInvalid(soundingData[soundingDataIndex])) { // go up in the sounding until the altitude matches, or is more than the in sim altitude
      soundingDataIndex--;
    }

    const sampleAboveOrEqual = soundingData[soundingDataIndex];

    const sampleBelow = soundingData[Math.min(soundingDataIndex + 1, soundingData.length - 1)];

    let s = sampleAboveOrEqual;
    if (sampleAboveOrEqual['alt'] != inSimAlt && inSimAlt >= soundingData[soundingData.length - 1].alt) {
      let a = (inSimAlt - sampleBelow['alt']) / (sampleAboveOrEqual['alt'] - sampleBelow['alt']);
      s = mixGeneric(sampleBelow, sampleAboveOrEqual, a);
    }

    // console.log(inSimAlt, sampleBelow['alt'], sampleAboveOrEqual['alt'], s);

    let twoDimentionalVel = s.vel * Math.cos(s.angle * degToRad);   // km/h

    const inSimVel = msToRawVelocity(twoDimentionalVel / 3.6);      // convert to m/s first

    soundingForSim[y] = {'t' : s.t, 'td' : s.td, 'vel' : inSimVel}; // Put the requered data in an array of objects
  }

  // console.log('soundingForSim', soundingForSim);

  return soundingForSim;
}

var stationSelector;

const presets = [
  {name : 'Summer storms in northern Italy', location : 'Milan', date : '2025-06-05', hour : 12}, {name : 'Some cells in the Netherlands', location : 'Essen', date : '2016-06-23', hour : 12},
  {name : 'Supercell in the Netherlands', location : 'De Bilt', date : '2014-06-09', hour : 12}, {name : 'Cold winter on Gotland', location : 'Gotland', date : '2025-01-03', hour : 12},
  {name : 'Spring cells in Germany', location : 'Stuttgart', date : '2021-06-09', hour : 12}, {name : 'Hot summer in Spain', location : 'Madrid', date : '2018-07-07', hour : 12},
  {name : 'Double inversion over Sicily', location : 'Sicily', date : '2021-07-14', hour : 12}, {name : 'Low base with CAPE in Rome', location : 'Rome', date : '2021-07-16', hour : 12},
  {name : 'High low level cape over mediterranean in fall', location : 'Ajaccio', date : '2025-10-23', hour : 12}
];

var startDate;
var startLatitude;

function createPresetSelect()
{
  let select = document.getElementById('presetSelect');

  //  console.log(presets);

  presets.forEach((preset, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = preset.name;
    select.appendChild(option);
  });
  select.value = -1;

  select.onchange = function() {
    let preset = presets[select.selectedIndex];

    document.getElementById('datePicker').value = preset.date;

    startDate = new Date(preset.date);

    document.getElementById('hourSelector').value = preset.hour;

    stationSelector.selectedIndex = Object.keys(soundingStations).indexOf(preset.location);
    stationSelector.dispatchEvent(new Event('change', {bubbles : true}));

    prepareSounding();
  };
}

const soundingStations = {
  'Andoya' : {id : 1010, lat : 69.1144},
  'Lapland' : {id : 2836, lat : 67.4160},
  'Iceland' : {id : 4018, lat : 64.9631},
  'Trondheim' : {id : 1241, lat : 63.4305},
  'Helsinki' : {id : 2963, lat : 60.1699},
  'Stavanger' : {id : 1415, lat : 58.9700},
  'Gotland' : {id : 2591, lat : 57.6359},
  'North Sea' : {id : 1400, lat : 56.5333},
  'Moscow' : {id : 27730, lat : 55.7558},
  'Gdańsk' : {id : 12120, lat : 54.3520},
  'Greifswald' : {id : 10184, lat : 54.0833},
  'Norderney' : {id : 10113, lat : 53.7000},
  'Hamburg' : {id : 10035, lat : 53.5507},
  'Nottingham' : {id : 3354, lat : 52.9500},
  'Bergen(DE)' : {id : 10238, lat : 52.8092},
  'Meppen' : {id : 10304, lat : 52.7928},
  'Berlin' : {id : 10393, lat : 52.5235},
  'Warsaw' : {id : 12374, lat : 52.2297},
  'De Bilt' : {id : 6260, lat : 52.1085},
  'Essen' : {id : 10410, lat : 51.4556},
  'Wroclaw' : {id : 12425, lat : 51.1079},
  'Brussels' : {id : 6458, lat : 50.8371},
  'Meiningen' : {id : 10548, lat : 50.5678},
  'Kraków' : {id : 12575, lat : 50.0647},
  'Idar-Oberstein' : {id : 10618, lat : 49.7167},
  'Nuremberg' : {id : 10771, lat : 49.4521},
  'Paris' : {id : 7145, lat : 48.8567},
  'Stuttgart' : {id : 10739, lat : 48.7758},
  'Brest' : {id : 7110, lat : 48.3900},
  'Vienna' : {id : 11035, lat : 48.2092},
  'Altenstadt' : {id : 10954, lat : 48.3556},
  'Munich' : {id : 10868, lat : 48.1333},
  'peißenberg' : {id : 10962, lat : 47.7975},
  'Insbruck' : {id : 11120, lat : 47.2692},
  'Bern' : {id : 6610, lat : 46.9480},
  'Udine' : {id : 16045, lat : 46.0713},
  'Zagreb' : {id : 14240, lat : 45.8150},
  'Milan' : {id : 16064, lat : 45.4642},
  'Bordeaux' : {id : 7510, lat : 44.8378},
  'Bologna' : {id : 16144, lat : 44.4968},
  'Bucharest' : {id : 15420, lat : 44.4268},
  'Cuneo' : {id : 16113, lat : 44.3843},
  'Zadar' : {id : 14430, lat : 44.1194},
  'Montpellier' : {id : 7645, lat : 43.6119},
  'Barcelona' : {id : 8190, lat : 41.3851},
  'Ajaccio' : {id : 7761, lat : 41.9192},
  'Rome' : {id : 16245, lat : 41.9028},
  'Istanbul' : {id : 17064, lat : 41.0082},
  'Madrid' : {id : 8221, lat : 40.4168},
  'Sardinia' : {id : 16546, lat : 40.1209},
  'Lisbon' : {id : 8536, lat : 38.7223},
  'Athens' : {id : 16716, lat : 37.9792},
  'Sicily' : {id : 16429, lat : 37.6000},
  'Krete' : {id : 16754, lat : 35.2401},
  'Cyprus' : {id : 17607, lat : 35.1264},
  'Palestine' : {id : 40179, lat : 32.0853},
  'Cairo' : {id : 62378, lat : 30.0444},
};

function createStationSelect()
{
  let select = document.getElementById('stationSelect');

  for (const [key, value] of Object.entries(soundingStations)) {
    let option = document.createElement('option');
    option.value = value.id;
    option.innerHTML = key + ' ' + value.lat.toFixed(1) + '° N';
    select.appendChild(option);
  }
  select.value = 10868;

  select.onchange = function() {
    startLatitude = Object.values(soundingStations)[select.selectedIndex].lat;
    prepareSounding();
  };

  let datePicker = document.getElementById('datePicker');
  datePicker.onchange = function() {
    startDate = new Date(datePicker.value);
    prepareSounding();
  };

  return select;
}


// Ensure the DOM is fully loaded before running the function
document.addEventListener('DOMContentLoaded', () => {
  createPresetSelect();
  stationSelector = createStationSelect();
  prepareSounding();
});


var canvas;
var gl;

var clockEl;

var simDateTime;

var SETUP_MODE = false;

var loadingBar;
var cam;
var soundSystem;

const PI = 3.14159265359;
const degToRad = 0.0174533;
const radToDeg = 57.2957795;
const kmToMil = 0.62137;
const mToFt = 3.28084;

const saveFileVersionID = 263574036; // Uint32 id to check if save file is compatible

const guiControls_default = {
  vorticity : 0.005,
  dragMultiplier : 0.001, // 0.01
  wind : 0.0,
  coriolisStrength : 1.0,
  turbulentMix : 1.0,
  jetStreamCoupling : 1.0,
  gravityWaveDrag : 1.0,
  mountainWaveStrength : 1.0,
  vortexStretching : 1.0,
  ageostrophicFlow : 1.0,
  moistBuoyancyBoost : 1.0,
  gravityCurrentStrength : 1.0,
  shearProduction : 1.0,
  tornadoPotential : 1.0,
  frontogenesisStrength : 1.0,
  supercellHelicity : 1.0,
  mesocycloneFeedback : 1.0,
  stormRelativeInflow : 1.0,
  occlusionDowndraftCoupling : 1.0,
  gradientRichardsonMix : 1.0,
  turbulentPrandtl : 0.85,
  pblDepthMeters : 1800.0,
  entrainmentFluxBoost : 1.0,
  airplanePitchAuthority : 1.0,
  airplaneThrottleResponse : 1.0,
  showTornadoLabels : true,
  electricFieldVizStrength : 1.0,
  dynamicChargeSeparation : 1.0,
  electricFieldDiffusion : 1.0,
  cloudLifetimeBoost : 1.35,
  lightningRodRadiusKm : 25.0,
  airplaneLightningAttractor : 0.0,
  showLightningRods : false,
  allowEditingWhenPaused : true,
  entrainmentDilution : 1.0,
  kesslerAutoconversion : 1.0,
  ventilationEvapEnhancement : 1.0,
  drizzleThresholdShift : 1.0,
  graupelChargeGain : 1.0,
  iceCrystalChargeGain : 1.0,
  terrainRuggednessBoost : 1.0,
  terrainWetnessRecovery : 1.0,
  terrainRiverBias : 1.0,
  globalEffectsStartAlt : 0,
  globalEffectsEndAlt : 10000,
  globalDrying : 0.000000, // 0.000010
  globalHeating : 0.0,
  soundingForcing : 0.0,
  sunIntensity : 1.0,
  waterTemperature : 25.0, // °C
  dynamicWaterTemperature : true,
  landEvaporation : 0.00005,
  waterEvaporation : 0.0001,
  evapHeat : 2.90,          //  Real: 2260 J/g
  meltingHeat : 0.43,       //  Real:  334 J/g
  condensationRate : 0.0050,
  waterWeight : 0.25,       // 0.50
  inactiveDroplets : 0,
  aboveZeroThreshold : 1.0, // PRECIPITATION
  subZeroThreshold : 0.005, // 0.01
  spawnChance : 0.00005,
  lightningChanceMult : 0.002,
  lightningMinInterval : 1,// 30. 10 to 50
  snowDensity : 0.2,        // 0.3
  fallSpeed : 0.0003,
  growthRate0C : 0.0001,    // 0.0005
  growthRate_30C : 0.001,   // 0.01
  freezingRate : 0.01,
  meltingRate : 0.01,
  evapRate : 0.0008, // 0.0005
  displayMode : 'DISP_REAL',
  wrapHorizontally : true,
  SmoothCam : true,
  camSpeed : 0.01,
  exposure : 1.0,
  timeOfDay : 9.9,
  latitude : 45.0,
  month : 6.65, // Northern hemisphere summer solstice
  sunAngle : 9.9,
  dayNightCycle : true,
  accelerateNight : true,
  greenhouseGases : 0.001,
  waterGreenHouseEffect : 0.0015,
  IR_rate : 1.0,
  radiationHaze : 1.0,
  introShaderQuality : 1.0,
  introLightningVisualStrength : 1.0,
  introPrecipVisualStrength : 1.0,
  diurnalThermalLag : 1.0,
  tool : 'TOOL_NONE',
  brushSize : 20,
  wholeWidth : false,
  brushIntensity : 0.01,
  flashlightIntensity : 1.0,
  flashlightFocus : 1.0,
  flashlightRange : 1.0,
  allowCaves : true,
  showGraph : false,
  realDewPoint : false, // show real dew point in graph, instead of dew point with cloud water included
  enablePrecipitation : true,
  showDrops : false,
  cameraShake : true,
  shakeFrequency : 1.45,
  shakeDecay : 0.78,
  lightningTempShakeMult : 1.20,
  lightningMotionBlur : 0.0,
  lightningColorTempMult : 1.0,
  icLightningRatio : 0.62,
  ctgLightningRatio : 0.38,
  lightningFlashRate : 1.35,
  lightningComplexity : 1.0,
  multiStrokeLightning : 1.0,
  lightningFlashPersistence : 0.72,
  lightningTempMinK : 9000.0,
  lightningTempMaxK : 33000.0,
  precipitationVisualBoost : 1.0,
  precipitationTint : 1.0,
  precipitationContrast : 1.0,
  renderScale : 1.0,
  pixelRatioScale : 0.5,
  graphicsPreset : 'High',
  simulationProfile : 'Balanced',
  ambientScattering : 1.0,
  cloudLayerComplexity : 1.0,
  precipitationEffectMult : 1.0,
  lightningGroundBias : 1.0,
  lightningBloomStrength : 1.0,
  stormOrganization : 1.0,
  aerosolLoad : 1.0,
  entrainmentRate : 1.0,
  downdraftCoolingMult : 1.0,
  microburstStrength : 1.0,
  lightningBranching : 1.0,
  lightningAnvilDrift : 1.0,
  precipitationSizeSpectrum : 1.0,
  hailShatterFactor : 1.0,
  stormMoistureLift : 1.0,
  lightningFrequencyBoost : 1.0,
  dryLightningAllowance : 0.35,
  stormPulseStrength : 0.0,
  lightningRecoveryBoost : 1.0,
  precipitationRecycling : 1.0,
  surfaceRunoffRate : 1.0,
  soilInfiltrationRate : 1.0,
  canopyInterception : 1.0,
  urbanHeatIslandStrength : 1.0,
  coastalMixing : 1.0,
  waterAlbedoShift : 0.0,
  mobilePrecipBoost : 1.25,
  balloonBurstPressure : 250.0,
  balloonTelemetryDetailed : false,
  showFPS : true,
  showWeatherBalloons : true,
  balloonRiseRate : 0.22,
  balloonDriftMult : 1.0,
  paused : false,
  IterPerFrame : 10,
  auto_IterPerFrame : true,
  sound : true,
  dryLapseRate : 10.0,     // Real: 9.8 degrees / km
  simHeight : 12000,       // meters
  twelveHourClock : false, // only for display.  false = metric
  lengthUnit : 'LENGTH_UNIT_METRIC',
  tempUnit : 'TEMP_UNIT_C',
  windUnit : 'SPEED_UNIT_KMH',
};

var horizontalDisplayMult = 3.0; // 3.0 to cover srceen while zoomed out

var guiControls;

var displayVectorField = false;

var displayWeatherStations = true;

var sunIsUp = true;

var airplaneMode = false;
var mobileFlightUi = null;

var dropletFollowID = -1;

var minShadowLight = 0.02;

var saveFileName = '';
var fpsCounterEl;
var tornadoLabelEl;

var guiControlsFromSaveFile = null;
var datGui;
var runtimeDeviceInfo = null;

var sim_res_x;
var sim_res_y;
var sim_aspect; //  = sim_res_x / sim_res_y
var sim_height = 12000;

var cellHeight = 12000. / 300.; // guiControls.simHeight / sim_res_y;  // in meters // cell width is the same

var frameNum = 0;
var lastFrameNum = 0;

var iterNum = 0;
var lightningPauseStartFrame = 0;
var lightningPauseStartIter = 0;
var lightningWasPaused = false;

var lightningShakeOffsetX = 0.0;
var lightningShakeOffsetY = 0.0;
var lightningShakeVelocityX = 0.0;
var lightningShakeVelocityY = 0.0;
var lightningShakeHFAmplitude = 0.0;
var lightningShakeHFOffsetX = 0.0;
var lightningShakeHFOffsetY = 0.0;
var lightningShakePhaseX = 0.0;
var lightningShakePhaseY = 0.0;
var pendingLightningShakeEvents = [];

// global framebuffers for measurements
var frameBuff_0;
var lightFrameBuff_0;

var dryLapse;


const timePerIteration = 0.00008; // in hours (0.00008 = 0.288 sec, at 40m cell size that means the speed of light & sound = 138.88 m/s = 500 km/h)

var NUM_DROPLETS;
const NUM_DROPLET_MULTIPLIER = 12.5;
let filteredInactiveDroplets = 0.0;

function computeNumDroplets(resX, resY)
{
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const touchCapable = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  let mobileFactor = (coarsePointer || touchCapable || mobileUA) ? 0.44 : 1.0;

  // Extra safety for high DPR mobile browsers.
  if (window.devicePixelRatio >= 2.0 && mobileFactor < 1.0)
    mobileFactor *= 0.80;

  const rawDroplets = Math.floor(resX * resY * NUM_DROPLET_MULTIPLIER * mobileFactor);

  // Unlimited droplet ceiling: keep only a minimum floor so low-resolution runs still show precipitation.
  return Math.max(rawDroplets, 18000);
}

function isMobileLikeDevice()
{
  if (window.matchMedia && window.matchMedia('(pointer:coarse)').matches)
    return true;
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function getEffectivePixelRatio()
{
  const sliderScale = clamp(guiControls?.pixelRatioScale ?? 1.0, 0.5, 1.5);
  const dpr = window.devicePixelRatio || 1.0;
  return clamp(dpr * sliderScale, 0.75, 2.5);
}

function getDeviceInfoSummary()
{
  const memory = navigator.deviceMemory ? navigator.deviceMemory + ' GB RAM' : 'RAM n/a';
  const cores = navigator.hardwareConcurrency ? navigator.hardwareConcurrency + ' threads' : 'threads n/a';
  return `${navigator.platform || 'unknown platform'} • DPR ${((window.devicePixelRatio || 1.0)).toFixed(2)} • ${memory} • ${cores}`;
}

function getAdaptiveEvapRate()
{
  const baseRate = guiControls?.evapRate ?? guiControls_default.evapRate;
  const waterTemp = guiControls?.waterTemperature ?? guiControls_default.waterTemperature;
  const windAssist = guiControls?.coastalMixing ?? guiControls_default.coastalMixing;
  const tempFactor = map_range(Math.min(Math.max(waterTemp, -5.0), 35.0), -5.0, 35.0, 0.78, 1.34);
  const windFactor = map_range(Math.min(Math.max(windAssist, 0.2), 2.5), 0.2, 2.5, 0.9, 1.22);
  return baseRate * tempFactor * windFactor;
}


function getMobileLightningVisibility()
{
  const coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
  const baseVisibility = Math.max(1.0, guiControls?.mobilePrecipBoost ?? guiControls_default.mobilePrecipBoost);
  return coarse ? Math.max(baseVisibility * 1.6, 2.0) : baseVisibility;
}

let hdrFBO;

let bloomFBOs = [];

let ambientLightFBOs = [];
let emittedLightFBO;


function clamp(num, min, max) { return Math.min(Math.max(num, min), max); }

function screenToSimX(screenX)
{
  let leftEdge = canvas.width / 2.0 - (canvas.width * cam.curZoom) / 2.0;
  let rightEdge = canvas.width / 2.0 + (canvas.width * cam.curZoom) / 2.0;
  return map_range(screenX, leftEdge, rightEdge, 0.0, 1.0) - cam.curXpos / 2.0;
}

function screenToSimY(screenY)
{
  let topEdge = canvas.height / 2.0 - ((canvas.width / sim_aspect) * cam.curZoom) / 2.0;
  let bottemEdge = canvas.height / 2.0 + ((canvas.width / sim_aspect) * cam.curZoom) / 2.0;
  return map_range(screenY, bottemEdge, topEdge, 0.0, 1.0) - (cam.curYpos / 2.0) * sim_aspect;
}

function simToScreenX(simX)
{
  simX += 0.5;
  simX /= sim_res_x;
  let leftEdge = canvas.width / 2.0 - (canvas.width * cam.curZoom) / 2.0;
  let rightEdge = canvas.width / 2.0 + (canvas.width * cam.curZoom) / 2.0;
  return map_range(simX + cam.curXpos / 2.0, 0.0, 1.0, leftEdge, rightEdge);
}

function simToScreenY(simY)
{
  simY += 0.5; // center in cell
  simY /= sim_res_y;
  let topEdge = canvas.height / 2.0 - ((canvas.width / sim_aspect) * cam.curZoom) / 2.0;
  let bottemEdge = canvas.height / 2.0 + ((canvas.width / sim_aspect) * cam.curZoom) / 2.0;
  return map_range(simY + (cam.curYpos / 2.0) * sim_aspect, 0.0, 1.0, bottemEdge, topEdge);
}

function download(filename, data)
{
  var url = URL.createObjectURL(data);
  const element = document.createElement('a');
  element.setAttribute('href', url);
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

// Universal Functions

function mod(a, b)
{
  // proper modulo to handle negative numbers
  return ((a % b) + b) % b;
}

function map_range(value, low1, high1, low2, high2) { return low2 + ((high2 - low2) * (value - low1)) / (high1 - low1); }

function map_range_C(value, low1, high1, low2, high2) { return clamp(low2 + ((high2 - low2) * (value - low1)) / (high1 - low1), Math.min(low2, high2), Math.max(low2, high2)); }

// Temperature Functions

function CtoK(C) { return C + 273.15; }

function KtoC(K) { return K - 273.15; }

function CtoF(C) { return C * 1.8 + 32.0; }


function dT_saturated(dTdry, dTl)
{
  // dTl = temperature difference because of latent heat
  // if (dTl == 0.0)
  //   return dTdry;
  //  else {
  var multiplier = dTdry / (dTdry - dTl);
  return dTdry * multiplier;
  // }
}

const IR_constant = 5.670374419; // ×10−8

function IR_emitted(T)
{
  return Math.pow(T * 0.01, 4) * IR_constant; // Stefan–Boltzmann law
}

function IR_temp(IR)
{
  // inversed Stefan–Boltzmann law
  return Math.pow(IR / IR_constant, 1.0 / 4.0) * 100.0;
}

////////////// Water Functions ///////////////
const wf_devider = 250.0;
const wf_pow = 17.0;

function maxWater(Td)
{
  return Math.pow(Td / wf_devider,
                  wf_pow); // w = ((Td)/(250))^(18) // Td in Kelvin, w in grams per m^3
}

function dewpoint(W, tempK = 273.15)
{
  // Reworked dew point from absolute humidity using ideal-gas vapor pressure relation.
  const absHumidity = Math.max(W, 0.00001); // g/m^3
  const safeTempK = clamp(tempK, 170.0, 340.0);
  const vaporDensity = absHumidity * 0.001; // kg/m^3
  const vaporPressure_hPa = clamp((vaporDensity * 461.5 * safeTempK) / 100.0, 0.01, 110.0);
  const lnRatio = Math.log(vaporPressure_hPa / 6.112);
  const TdC = (243.5 * lnRatio) / (17.67 - lnRatio);
  return CtoK(clamp(TdC, -90.0, 55.0));
}

function relativeHumd(T, W) { return (W / maxWater(T)) * 100.0; }

// Print funtions:

function convertTempToSelectedUnit(tempC)
{
  switch (guiControls.tempUnit) {
  case 'TEMP_UNIT_C':
    return tempC;
  case 'TEMP_UNIT_F':
    return CtoF(tempC);
  case 'TEMP_UNIT_K':
    return (tempC + 273.15);
  }
}

function printTemp(tempC)
{
  let tempStr = convertTempToSelectedUnit(tempC).toFixed(1);
  switch (guiControls.tempUnit) {
  case 'TEMP_UNIT_C':
    return tempStr + '°C';
  case 'TEMP_UNIT_F':
    return tempStr + '°F';
  case 'TEMP_UNIT_K':
    return tempStr + ' K';
  }
}

function mmToIn(mm) { return mm * 0.393701; }

function msToKnots(ms) { return ms * 1.94384; };

function msToMPH(ms) { return ms * 2.23694; };

function knotsToMs(kt) { return kt * 0.514444; };

function printSnowHeight(snowHeight_cm)
{
  if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL') {
    return mmToIn(snowHeight_cm).toFixed(1) + '"'; // inches
  } else
    return snowHeight_cm.toFixed(1) + ' cm';
}

function printSoilMoisture(soilMoisture_mm)
{
  if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL') {
    return mmToIn(soilMoisture_mm).toFixed(1) + '"'; // inches
  } else
    return soilMoisture_mm.toFixed(1) + ' mm';
}


function printDistance(m)
{
  if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL') {
    let miles = m * kmToMil / 1000;
    let ft = m * mToFt;
    return miles < 1.0 ? ft.toFixed(0) + ' ft' : miles.toFixed(1) + ' miles';
  } else {
    let km = m / 1000;
    return m < 1000 ? m.toFixed(0) + ' m' : km.toFixed(1) + ' km';
  }
}

function printAltitude(meters)
{
  if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL') {
    let feet = meters * mToFt;
    return feet.toFixed() + ' ft';
  } else
    return meters.toFixed() + ' m';
}

function convertVelocityToSelectedUnit(ms)
{
  switch (guiControls.speedUnit) {
  case 'SPEED_UNIT_KMH':
    return ms * 3.6;
  case 'SPEED_UNIT_MS':
    return ms;
  case 'SPEED_UNIT_MPH':
    return msToMPH(ms);
  case 'SPEED_UNIT_KT':
    return msToKnots(ms);
  }
}

function printVelocity(ms)
{
  let velStr = convertVelocityToSelectedUnit(ms).toFixed();
  switch (guiControls.speedUnit) {
  case 'SPEED_UNIT_KMH':
    return velStr + ' km/h';
  case 'SPEED_UNIT_MS':
    return velStr + ' m/s';
  case 'SPEED_UNIT_MPH':
    return velStr + ' MPH';
  case 'SPEED_UNIT_KT':
    return velStr + ' kt';
  }
}

function printVerticalVelocity(ms)
{
  let veloStr = ms >= 0. ? '+' : '';
  let unitStr = '';

  if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL') {
    veloStr += (ms * 196.8504).toFixed(0);
    unitStr = ' ft/m';
  } else {
    veloStr += ms.toFixed(1);
    unitStr = ' m/s';
  }
  return [ veloStr, unitStr ];
}

function rawVelocityTo_ms(vel)
{                          // Raw velocity is in cells/iteration
  vel /= timePerIteration; // convert to cells per hour
  vel *= cellHeight;       // convert to meters per hour
  vel /= 3600.0;           // convert to m/s
  return vel;
}

function msToRawVelocity(vel)
{                          // Raw velocity is in cells/iteration
  vel *= 3600;             // convert to meters per hour
  vel /= cellHeight;       // convert to cells per hour
  vel *= timePerIteration; // convert to raw (cells per iteration)
  return vel;
}

function CtoK(c) { return c + 273.15; }

function realToPotentialT(realT, y) { return realT + (y / sim_res_y) * dryLapse; }

function potentialToRealT(potentialT, y) { return potentialT - (y / sim_res_y) * dryLapse; }


// Global Classes:

class Vec2D // simple 2D vector
{
  x;
  y;
  constructor(x = 0, y = 0)
  {
    this.x = x;
    this.y = y;
  }
  static fromAngle(angle, mag) // create vector from angle and optional magnitude
  {
    if (mag == null)
      mag = 1.0;
    let x = -Math.cos(angle) * mag;
    let y = Math.sin(angle) * mag;
    return new Vec2D(x, y);
  }

  copy() { return new Vec2D(this.x, this.y); }
  add(other)
  {
    this.x += other.x;
    this.y += other.y;
    return this;
  }
  subtract(other)
  {
    this.x -= other.x;
    this.y -= other.y;
    return this;
  }
  mult(mult)
  {
    this.x *= mult;
    this.y *= mult;
    return this;
  }
  div(div)
  {
    this.x /= div;
    this.y /= div;
    return this;
  }

  rotate(angle) // rotate vector
  {
    let newX = Math.sin(angle) * this.y + Math.cos(angle) * this.x;
    this.y = Math.cos(angle) * this.y - Math.sin(angle) * this.x;
    this.x = newX;
    return this;
  }

  mag() { return Math.sqrt(this.x * this.x + this.y * this.y); } // get magnitude of vector

  magSq() { return this.x * this.x + this.y * this.y; }          // square of magnitude

  angle()                                                        // get angle of vector
  {
    return Math.atan(this.y / -this.x);
  }
}

class FBO // wraps texture, frambuffer and info in one
{
  width;
  height;
  texelSizeX;
  texelSizeY;
  texture;
  frameBuffer;

  constructor(w, h, internalFormat, format, type, texFilter, wrapMode_S)
  {
    this.width = w;
    this.height = h;
    gl.activeTexture(gl.TEXTURE0);
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, texFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, texFilter);

    if (!wrapMode_S)
      wrapMode_S = gl.CLAMP_TO_EDGE;

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode_S);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    this.frameBuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.texelSizeX = 1.0 / this.width;
    this.texelSizeY = 1.0 / this.height;
  }
}

function createHdrFBO() { hdrFBO = new FBO(canvas.width, canvas.height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR); }

function createBloomFBOs()
{
  let res = new Vec2D(canvas.width, canvas.height);

  bloomFBOs.length = 0;           // empty array
  for (let i = 0; i < 100; i++) { // max bloom iterations
    let width = res.x >> i;       // right shift to devide by 2 multiple times
    let height = res.y >> i;

    //  console.log('BloomFBO', i, width, height)

    if (width < 2 || height < 2)
      break; // stop when texture resolution is 2 x 2

    let fbo = new FBO(width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    bloomFBOs.push(fbo);
  }
}


function createAmbientLightFBOs()
{
  emittedLightFBO = new FBO(sim_res_x, sim_res_y, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);

  let res = new Vec2D(sim_res_x, sim_res_y);

  // console.log('createAmbientLightFBOs');

  ambientLightFBOs.length = 0;   // empty array
  for (let i = 0; i < 80; i++) { // max iterations
    let width = res.x >> i;      // right shift to devide by 2 multiple times
    let height = res.y >> i;

    if (width < 2 || height < 2)
      break; // stop when texture width or height is <= 2

    let fbo = new FBO(width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, gl.REPEAT);
    ambientLightFBOs.push(fbo);
  }
}

class Weatherstation
{
  #width = 120; // 100 display size
  #height = 70; // 55
  #mainDiv;
  #canvas;
  #c; // 2d canvas context
  #x; // position in simulation
  #y;

  #isOnLand = false;
  #isOnWater = false;

  #time;             // ISO time string of moment of last measurement
  #temperature = 0;  // °C
  #dewpoint = 0;     // °C
  #relativeHumd = 0; // %
  #velocity = 0;     // ms
  #soilMoisture = 0; // mm
  #snowHeight = 0;   // cm
  #airQuality = 0;   // AQI
  #waterTemperature = 0;
  #pressure_hPa = 1013.25;
  #pressureTrend = 0.0;
  #verticalVelocity = 0.0;

  #netIRpow = 0;
  #solarPower = 0;

  #chartCanvas;
  #historyChart;

  #displaySunAndIRPower;


  constructor(xIn, yIn)
  {
    this.#x = Math.floor(xIn);
    this.#y = Math.floor(yIn);
    this.#mainDiv = document.createElement('div');
    this.#canvas = document.createElement('canvas');
    this.#mainDiv.appendChild(this.#canvas);
    document.body.appendChild(this.#mainDiv);
    this.#canvas.height = this.#height;
    this.#canvas.width = this.#width;

    this.#mainDiv.style.position = 'absolute';
    this.#mainDiv.style.width = '0px';
    this.#mainDiv.style.height = '0px';

    this.#c = this.#canvas.getContext('2d');

    this.#canvas.style.position = 'absolute';
    this.#canvas.style.zIndex = 1; // z-index

    this.#displaySunAndIRPower = false;

    let thisObj = this;
    this.#canvas.addEventListener('mousedown', function(event) {
      if (event.button == 0) {     // left mouse button
        if (guiControls.tool == 'TOOL_STATION') {
          thisObj.destroy();       // remove weather station
          event.stopPropagation(); // prevent mousedown on body from firing
        } else {
          if (guiControls.dayNightCycle == true) {
            thisObj.#chartCanvas.style.display = (thisObj.#chartCanvas.style.display == 'none') ? 'block' : 'none'; // toggle visibility of chart canvas
          }
        }
      } else if (event.button == 2) {                                   // right mouse button
        thisObj.#displaySunAndIRPower = !thisObj.#displaySunAndIRPower; // toggle display of radiation flux
      }
    });

    this.#canvas.addEventListener('contextmenu', function(event) { event.preventDefault(); }); // Prevent the browser's context menu from appearing

    this.createChartJSCanvas();
  }

  createChartJSCanvas()
  {
    this.#chartCanvas = document.createElement('canvas');

    this.#mainDiv.appendChild(this.#chartCanvas);

    const ctx = this.#chartCanvas.getContext('2d');

    this.#chartCanvas.height = 400;
    this.#chartCanvas.width = 500;

    let style = this.#chartCanvas.style;

    style.marginTop = '100px';

    style.position = 'relative';

    style.left = '-200px';

    style.display = 'none'; // hide initially


    this.#historyChart = new Chart(ctx, {
      type : 'line',
      data : {
        labels : [], // Time-based labels
        datasets : [
          {
            label : 'Temperature',
            data : [],
            backgroundColor : 'rgba(255, 0, 0, 0.9)',
            borderColor : 'rgba(255, 0, 0, 1)',
            radius : 0,
            borderWidth : 1,
            fill : false,
          },
          {
            label : 'Dew Point',
            data : [],
            backgroundColor : '#00FFFF',
            borderColor : '#00FFFF',
            radius : 0,
            borderWidth : 1,
            fill : false,
          },
          {label : 'Wind Speed', data : [], backgroundColor : '#AAAAAA', borderColor : '#AAAAAA', radius : 0, borderWidth : 1, fill : false, hidden : true},                            //
          {label : 'Air Quality', data : [], backgroundColor : '#803c00', borderColor : '#803c00', radius : 0, borderWidth : 1, fill : false, hidden : true},                           //
          {label : 'Precipitation', data : [], backgroundColor : '#0055FF', borderColor : '#0055FF', radius : 0, borderWidth : 1, fill : false, hidden : true, reallyHidden : true},    //
          {label : 'Snow Height', data : [], backgroundColor : '#FFFFFF', borderColor : '#FFFFFF', radius : 0, borderWidth : 1, fill : false, hidden : true, reallyHidden : true},      //
          {label : 'Water Temperature', data : [], backgroundColor : '#406cff', borderColor : '#406cff', radius : 0, borderWidth : 1, fill : false, hidden : true, reallyHidden : true}, //
          {label : 'Pressure (hPa)', data : [], backgroundColor : '#ffc857', borderColor : '#ffc857', radius : 0, borderWidth : 1, fill : false, hidden : true} //
        ]
      },
      options : {
        scales : {
          x : {
            type : 'time', // Set the x-axis to use a time scale
            time : {unit : 'minute', tooltipFormat : 'HH:mm'},
            title : {
              display : true,
              color : 'white' // Make sure title color is white
            },
            ticks : {
              color : 'white' // White color for the x-axis labels
            },
            grid : {
              color : 'rgba(255, 255, 255, 0.2)' // Optional: light white for grid lines
            }
          },
          y : {
            beginAtZero : false, // Start the y-axis at 0
            ticks : {
              color : 'white'    // White color for the y-axis labels
            },
            title : {
              display : true,
              color : 'white' // Make sure title color is white
            },
            grid : {
              color : 'rgba(255, 255, 255, 0.2)' // Optional: light white for grid lines
            }
          }
        },
        plugins : {
          legend : {
            display : true,
            labels : {
              color : 'white', // White color for legend text
              font : {
                size : 14,
                family : 'Arial' // Optional: Ensure font family is set
              },
              filter : function(item, chart) { return !chart.datasets[item.datasetIndex].reallyHidden; }
            }
          }
        },
        responsive : false, // Auto rescale on canvas resize
        maintainAspectRatio : false,
        animation : false,  // Disables all animations
        normalized : true
        // parsing : false
      }
    });
  }

  updateChartJS() // add newest measurement to chart
  {
    if (this.#historyChart) {
      this.#historyChart.data.datasets[0].data.push(convertTempToSelectedUnit(this.#temperature));
      this.#historyChart.data.datasets[1].data.push(convertTempToSelectedUnit(this.#dewpoint));
      this.#historyChart.data.datasets[2].data.push(convertVelocityToSelectedUnit(this.#velocity));
      this.#historyChart.data.datasets[3].data.push(this.#airQuality);
      this.#historyChart.data.datasets[7].data.push(this.#pressure_hPa);

      if (this.#isOnLand) {
        this.#historyChart.data.datasets[4].data.push(guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL' ? mmToIn(this.#soilMoisture) : this.#soilMoisture);
        this.#historyChart.data.datasets[5].data.push(guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL' ? mmToIn(this.#snowHeight) : this.#snowHeight);
      } else if (this.#isOnWater) {
        this.#historyChart.data.datasets[6].data.push(convertTempToSelectedUnit(this.#waterTemperature));
      }

      this.#historyChart.data.labels.push(this.#time);

      if (this.#historyChart.data.labels.length > 60 * 24) { // max 24 hour history. Remove the oldest data and label
        this.#historyChart.data.labels.shift();
        this.#historyChart.data.datasets.forEach(dataSet => { dataSet.data.shift(); });
      }

      if (guiControls.dayNightCycle == true) {
        if (this.#chartCanvas.style.display != 'none') // only update if visible
          this.#historyChart.update();
      } else {
        this.#chartCanvas.style.display = 'none';
      }
    }
  }

  clearChart()
  {
    this.#historyChart.data.datasets.forEach(dataSet => { dataSet.data = []; });
    this.#historyChart.data.labels = [];
    this.#historyChart.update();
  }

  destroy()
  {
    this.#chartCanvas.remove();
    this.#canvas.parentElement.removeChild(this.#canvas); // remove canvas element
    let index = weatherStations.indexOf(this);
    weatherStations.splice(index, 1);                     // remove object from array
  }

  measure()
  {
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); // basetexture
    var baseTextureValues = new Float32Array(4 * 3);
    gl.readPixels(this.#x, this.#y - 1, 1, 3, gl.RGBA, gl.FLOAT, baseTextureValues);

    let T = potentialToRealT(baseTextureValues[1 * 4 + 3], this.#y); // temperature in kelvin

    this.#temperature = KtoC(T);
    const horizWind = Math.sqrt(Math.pow(baseTextureValues[2 * 4 + 0], 2) + Math.pow(baseTextureValues[4 + 1], 2));
    const vertWind = Math.abs(baseTextureValues[1 * 4 + 1]) * 0.65;
    this.#velocity = rawVelocityTo_ms(horizWind + vertWind);

    let altitudeM = this.#y * cellHeight;
    let hydrostaticPressure = 1013.25 * Math.exp(-altitudeM / 8400.0);
    let newPressure = hydrostaticPressure + baseTextureValues[1 * 4 + 2] * 120.0;
    this.#pressureTrend = newPressure - this.#pressure_hPa;
    this.#pressure_hPa = newPressure;
    this.#verticalVelocity = baseTextureValues[1 * 4 + 1] * 100.0;

    // gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
    gl.readBuffer(gl.COLOR_ATTACHMENT1); // watertexture
    var waterTextureValues = new Float32Array(2 * 4);
    gl.readPixels(this.#x, this.#y - 1, 1, 2, gl.RGBA, gl.FLOAT, waterTextureValues);

    if (waterTextureValues[4 + 0] > 1000.) { // is not air
      this.destroy();                        // remove weather station
      return;
    }

    if (waterTextureValues[0 + 0] > 1001.5) { // water wall
      this.#waterTemperature = KtoC(baseTextureValues[0 + 3]);
    } else {
      this.#waterTemperature = -100.;
    }

    this.#dewpoint = KtoC(dewpoint(waterTextureValues[4 + 0], T));

    if (guiControls.realDewPoint) {
      this.#dewpoint = Math.min(this.#temperature, this.#dewpoint);
    }

    this.#relativeHumd = relativeHumd(T, waterTextureValues[4 + 0]);

    if (guiControls.realDewPoint) {
      this.#relativeHumd = Math.min(this.#relativeHumd, 100.0);
    }


    if (waterTextureValues[0] > 1000.5 && waterTextureValues[0] < 1001.5) { // on land surface
      this.#soilMoisture = waterTextureValues[2];
      this.#snowHeight = waterTextureValues[3];

      if (!this.#isOnLand) {
        this.clearChart();
        this.#isOnLand = true;
        this.#isOnWater = false;
        this.#historyChart.data.datasets[4].reallyHidden = false;
        this.#historyChart.data.datasets[5].reallyHidden = false;
        this.#historyChart.data.datasets[6].reallyHidden = true;
      }

    } else if (waterTextureValues[0] > 1001.5) { // on water surface
      if (!this.#isOnWater) {
        this.clearChart();
        this.#isOnWater = true;
        this.#isOnLand = false;
        this.#historyChart.data.datasets[4].reallyHidden = true;
        this.#historyChart.data.datasets[5].reallyHidden = true;
        this.#historyChart.data.datasets[6].reallyHidden = false;
      }
    } else { // in air
      if (this.#isOnLand || this.#isOnWater) {
        this.clearChart();
        this.#isOnLand = false;
        this.#isOnWater = false;
        this.#soilMoisture = 0;
        this.#snowHeight = 0;
        this.#waterTemperature = -10.0;
        this.#historyChart.data.datasets[4].reallyHidden = true;
        this.#historyChart.data.datasets[5].reallyHidden = true;
        this.#historyChart.data.datasets[6].reallyHidden = true;
      }
    }


    this.#airQuality = waterTextureValues[4 + 3] * 300.0; // read smoke

    gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); // light texture
    var lightTextureValues = new Float32Array(4);
    gl.readPixels(this.#x, this.#y, 1, 1, gl.RGBA, gl.FLOAT, lightTextureValues);

    this.#netIRpow = lightTextureValues[2] - lightTextureValues[3]; // IR_DOWN - IR_UP
    // this.#netIRpow = lightTextureValues[1] / 0.000002; // or calculate from NET_HEATING

    let directSunlight = Math.max(lightTextureValues[0] * Math.sin(guiControls.sunAngle * degToRad), 0.0);

    this.#solarPower = directSunlight;

    this.#time = simDateTime.toISOString();
    this.updateChartJS(); // update chart
  }

  getXpos() { return this.#x; }

  getYpos() { return this.#y; }

  setHidden(hidden)
  {
    this.#mainDiv.style.display = hidden ? 'none' : 'block';
    this.#chartCanvas.style.display = 'none'; // hide charts
  }

  updateCanvas()
  {
    let screenX = simToScreenX(this.#x) - this.#width / 2;
    let screenY = simToScreenY(this.#y) - this.#height;

    // if (screenX > 0 && screenX < canvas.width && screenY > 0 && screenY < canvas.height) {
    this.#mainDiv.style.left = screenX + 'px';
    this.#mainDiv.style.top = screenY + 'px';
    // this.#canvas.style.left = screenX + 'px';
    // this.#canvas.style.top = screenY + 'px';
    let c = this.#c;
    c.clearRect(0, 0, this.#width, this.#height);
    c.fillStyle = '#00000000';
    c.fillRect(0, 0, this.#width, this.#height);

    // temperature
    c.font = '15px Arial';
    c.fillStyle = '#FFFFFF';
    c.fillText(printTemp(this.#temperature), 30, 15);

    if (this.#displaySunAndIRPower) {
      c.font = '12px Arial';
      c.fillStyle = '#00FFFF';
      c.fillText(this.#relativeHumd.toFixed(1) + ' %', 30, 28);

      c.fillStyle = '#FFFFFF';
      c.fillText('🔅 ' + this.#solarPower.toFixed(1) + 'W/m2', 10, 40);
      c.fillStyle = '#FFFFFF';
      c.fillText('♨️' + this.#netIRpow.toFixed(1) + 'W/m2', 10, 55);
    } else {
      c.font = '12px Arial';
      c.fillStyle = '#00FFFF';
      c.fillText(printTemp(this.#dewpoint), 30, 28);

      c.fillStyle = '#FFFFFF';
      c.fillText(printVelocity(this.#velocity), 20, 40);
      c.fillStyle = '#ffc857';
      const trendArrow = this.#pressureTrend > 0.03 ? '↑' : (this.#pressureTrend < -0.03 ? '↓' : '→');
      c.fillText(this.#pressure_hPa.toFixed(1) + ' hPa ' + trendArrow, 2, 52);
      c.fillStyle = '#b5d9ff';
      c.fillText((this.#verticalVelocity >= 0 ? '↑' : '↓') + ' ' + Math.abs(this.#verticalVelocity).toFixed(1) + ' m/s', 58, 40);

      if (this.#soilMoisture > 0.) {
        c.fillText(printSoilMoisture(this.#soilMoisture), 0, 64);
        c.fillText('💧', 20, 68);
      } else if (this.#waterTemperature > -1.0) {
        c.fillStyle = '#406cff';
        c.fillText(printTemp(this.#waterTemperature), 0, 64);
        c.fillText('🌊 🌡', 20, 68);
      }

      if (this.#snowHeight > 0.) {
        c.fillText(printSnowHeight(this.#snowHeight), 67, 64);
        c.font = '14px Arial';
        c.fillText('❄', 85, 68);
      }
    }


    // Position pointer
    c.beginPath();
    c.moveTo(this.#width / 2, this.#height * 0.80);
    c.lineTo(this.#width / 2, this.#height);
    c.strokeStyle = 'white';
    c.stroke();
    //  }
  }
}


class WeatherBalloon
{
  constructor(xIn, yIn)
  {
    this.x = Math.floor(xIn);
    this.y = Math.floor(yIn);
    this.age = 0;
    this.maxAge = 3600;
    this.destroyed = false;

    this.mainDiv = document.createElement('div');
    this.mainDiv.style.position = 'absolute';
    this.mainDiv.style.zIndex = '2';
    this.mainDiv.style.fontFamily = 'monospace';
    this.mainDiv.style.fontSize = '14px';
    this.mainDiv.style.color = '#ffd7f7';
    this.mainDiv.style.textShadow = '0 0 4px #000';
    document.body.appendChild(this.mainDiv);

    this.temperature = 0.0;
    this.dewpoint = 0.0;
    this.pressure_hPa = 1013.25;
    this.verticalWind = 0.0;
    this.ascentRate = 0.0;
  }

  measure()
  {
    if (this.destroyed)
      return;

    let clampedX = Math.floor(((this.x % sim_res_x) + sim_res_x) % sim_res_x);
    let clampedY = Math.floor(clamp(this.y, 1, sim_res_y - 2));

    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    let baseValues = new Float32Array(4);
    gl.readPixels(clampedX, clampedY, 1, 1, gl.RGBA, gl.FLOAT, baseValues);

    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    let waterValues = new Float32Array(4);
    gl.readPixels(clampedX, clampedY, 1, 1, gl.RGBA, gl.FLOAT, waterValues);

    if (waterValues[0] > 1000.0) {
      this.destroy();
      return;
    }

    this.temperature = KtoC(potentialToRealT(baseValues[3], clampedY / sim_res_y));
    this.dewpoint = KtoC(dewpoint(waterValues[0], CtoK(this.temperature)));

    let altitudeM = clampedY * cellHeight;
    let hydrostaticPressure = 1013.25 * Math.exp(-altitudeM / 8400.0);
    this.pressure_hPa = hydrostaticPressure + baseValues[2] * 120.0;
    this.verticalWind = baseValues[1] * 100.0;

    const precipDrag = clamp(waterValues[2] * 0.08 + waterValues[3] * 0.03, 0.0, 0.35);
    const turbulenceKick = (Math.random() - 0.5) * (0.02 + Math.abs(baseValues[1]) * 0.04);
    let driftScale = 0.5 * (sim_res_x / 900.0);
    this.x += (baseValues[0] + turbulenceKick) * driftScale * guiControls.balloonDriftMult * (1.0 - precipDrag * 0.55);
    this.ascentRate = (guiControls.balloonRiseRate + Math.max(baseValues[1], 0.0) * 3.5) * (1.0 - precipDrag);
    this.y += this.ascentRate;
    this.age++;

    if (this.age > this.maxAge || this.y >= sim_res_y - 2 || this.pressure_hPa <= guiControls.balloonBurstPressure)
      this.destroy();
  }

  updateCanvas()
  {
    if (this.destroyed)
      return;

    let screenX = simToScreenX(this.x);
    let screenY = simToScreenY(this.y);
    this.mainDiv.style.left = screenX + 'px';
    this.mainDiv.style.top = (screenY - 20) + 'px';
    if (guiControls.balloonTelemetryDetailed)
      this.mainDiv.innerText = '🎈 ' + this.pressure_hPa.toFixed(0) + 'hPa  T:' + this.temperature.toFixed(1) + '°C  Td:' + this.dewpoint.toFixed(1) + '°C  w:' + this.verticalWind.toFixed(1) + 'm/s';
    else
      this.mainDiv.innerText = '🎈 ' + this.pressure_hPa.toFixed(0) + 'hPa';
  }

  destroy()
  {
    if (this.destroyed)
      return;
    this.destroyed = true;
    if (this.mainDiv && this.mainDiv.parentNode)
      this.mainDiv.parentNode.removeChild(this.mainDiv);
  }
}


let weatherStations = []; // array holding all weather stations
let weatherBalloons = [];
let lightningRods = [];




function applyIntroShaderSettings()
{
  guiControls_default.lightningBloomStrength = readNumericInput('introLightningFxSel', guiControls_default.lightningBloomStrength ?? 1.0);
  guiControls_default.precipitationVisualBoost = readNumericInput('introPrecipFxSel', guiControls_default.precipitationVisualBoost ?? 1.0);
  guiControls_default.radiationHaze = readNumericInput('introShaderQualitySel', guiControls_default.radiationHaze ?? 1.0);

  const introGraphicsPreset = getEl('introGraphicsPreset');
  if (introGraphicsPreset && introGraphicsPreset.value)
    guiControls_default.graphicsPreset = introGraphicsPreset.value;

  const introSimulationProfile = getEl('introSimulationProfile');
  if (introSimulationProfile && introSimulationProfile.value)
    guiControls_default.simulationProfile = introSimulationProfile.value;
  guiControls_default.introShaderQuality = guiControls_default.radiationHaze;
  guiControls_default.introLightningVisualStrength = guiControls_default.lightningBloomStrength;
  guiControls_default.introPrecipVisualStrength = guiControls_default.precipitationVisualBoost;

  const introCloudLayerSel = getEl('introCloudLayerSel');
  if (introCloudLayerSel && introCloudLayerSel.value)
    guiControls_default.cloudLayerComplexity = parseFloat(introCloudLayerSel.value);
}


async function loadData()
{
  applyIntroShaderSettings();
  let file = document.getElementById('fileInput').files[0];

  if (file) {                                                    // load data from save file
    let versionBlob = file.slice(0, 4);                          // extract first 4 bytes containing version id
    let versionBuf = await versionBlob.arrayBuffer();
    let version = new Uint32Array(versionBuf)[0];                // convert to Uint32

    if (version == saveFileVersionID || version == 1939327491) { // also allow previous version, settings will not be loaded
      // check version id, only proceed if file has the right version id
      let fileArrBuf = await file.slice(4).arrayBuffer(); // slice from behind version id to
      // the end of the file
      let fileUint8Arr = new Uint8Array(fileArrBuf);        // convert to Uint8Array for pako
      let decompressed = window.pako.inflate(fileUint8Arr); // uncompress
      let dataBlob = new Blob([ decompressed ]);            // turn into blob

      let sliceStart = 0;
      let sliceEnd = 4;

      let resBlob = dataBlob.slice(sliceStart, sliceEnd); // extract first 4 bytes containing resolution
      let resBuf = await resBlob.arrayBuffer();
      resArray = new Uint16Array(resBuf);
      sim_res_x = resArray[0];
      sim_res_y = resArray[1];

      NUM_DROPLETS = computeNumDroplets(sim_res_x, sim_res_y);

      saveFileName = file.name;

      if (saveFileName.includes('.')) {
        saveFileName = saveFileName.split('.').slice(0, -1).join('.'); // remove extension
      }

      console.log('loading file: ' + saveFileName);
      console.log('File versionID: ' + version);
      console.log('sim_res_x: ' + sim_res_x);
      console.log('sim_res_y: ' + sim_res_y);


      sliceStart = sliceEnd;
      sliceEnd += sim_res_x * sim_res_y * 4 * 4;
      let baseTexBlob = dataBlob.slice(sliceStart, sliceEnd);
      let baseTexBuf = await baseTexBlob.arrayBuffer();
      let baseTexF32 = new Float32Array(baseTexBuf);

      sliceStart = sliceEnd;
      sliceEnd += sim_res_x * sim_res_y * 4 * 4; // 4 * float
      let waterTexBlob = dataBlob.slice(sliceStart, sliceEnd);
      let waterTexBuf = await waterTexBlob.arrayBuffer();
      let waterTexF32 = new Float32Array(waterTexBuf);

      sliceStart = sliceEnd;
      sliceEnd += sim_res_x * sim_res_y * 4 * 1; // 4 * byte
      let wallTexBlob = dataBlob.slice(sliceStart, sliceEnd);
      let wallTexBuf = await wallTexBlob.arrayBuffer();
      let wallTexI8 = new Int8Array(wallTexBuf);

      sliceStart = sliceEnd;
      sliceEnd += NUM_DROPLETS * Float32Array.BYTES_PER_ELEMENT * 5;
      let precipArrayBlob = dataBlob.slice(sliceStart, sliceEnd);
      let precipArrayBuf = await precipArrayBlob.arrayBuffer();
      let precipArray = new Float32Array(precipArrayBuf);

      if (version == saveFileVersionID) {             // only load settings and weather stations from save file if it's the newest version with all the settings included
        sliceStart = sliceEnd;
        sliceEnd += 1 * Int16Array.BYTES_PER_ELEMENT; // one 16 bit int indicates number of weather stations
        let numWeatherStationsArrayBlob = dataBlob.slice(sliceStart, sliceEnd);
        let numWeatherStationsBuf = await numWeatherStationsArrayBlob.arrayBuffer();
        let numWeatherStations = new Int16Array(numWeatherStationsBuf)[0];

        console.log('numWeatherStations', numWeatherStations);

        sliceStart = sliceEnd;
        sliceEnd += numWeatherStations * 2 * Int16Array.BYTES_PER_ELEMENT;
        let weatherStationArrayBlob = dataBlob.slice(sliceStart, sliceEnd);
        let weatherStationBuf = await weatherStationArrayBlob.arrayBuffer();
        let weatherStationArray = new Int16Array(weatherStationBuf);


        for (i = 0; i < numWeatherStations; i++) {
          weatherStations.push(new Weatherstation(weatherStationArray[i * 2], weatherStationArray[i * 2 + 1]));
        }

        sliceStart = sliceEnd;
        let settingsArrayBlob = dataBlob.slice(sliceStart); // until end of file


        guiControlsFromSaveFile = await settingsArrayBlob.text();
      } else {
        alert('Save File from older version, settings will not be loaded');
      }

      mainScript(baseTexF32, waterTexF32, wallTexI8, precipArray);
    } else {
      // wrong id
      alert('Incompatible file!');
      document.getElementById('fileInput').value = ''; // clear file
    }
  } else {
    // no file, so create new simulation
    sim_res_x = Math.round(readNumericInput('simResSelX', 512));
    sim_res_y = Math.round(readNumericInput('simResSelY', 300));
    sim_height = Math.round(readNumericInput('simHeightSel', 12000));
    sim_height = clamp(sim_height, 4000, 22000);

    NUM_DROPLETS = computeNumDroplets(sim_res_x, sim_res_y);
    SETUP_MODE = true;

    mainScript(null); // run without initial textures
  }
}

function loadImage(url)
{
  return new Promise((resolve, reject) => {
    let img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

class LoadingBar
{
  #loadingBar;
  #bar;
  #underBar;
  #percent;
  #description;
  #title;

  constructor(percentIn)
  {
    if (percentIn == null)
      this.percent = 0;
    else
      this.percent = percentIn;

    // create html
    this.loadingBar = document.createElement('div');
    this.bar = document.createElement('div');
    this.title = document.createElement('div');
    this.underBar = document.createElement('div');

    this.loadingBar.appendChild(this.title);
    this.loadingBar.appendChild(this.bar);
    this.loadingBar.appendChild(this.underBar);

    this.loadingBar.style.width = 'min(860px, 94vw)';
    this.loadingBar.style.height = '190px';
    this.loadingBar.style.color = '#d7f4ff';
    this.loadingBar.style.textAlign = 'center';
    this.loadingBar.style.background = 'linear-gradient(180deg, rgba(6,16,40,0.84), rgba(9,12,22,0.88))';
    this.loadingBar.style.backdropFilter = 'blur(8px)';
    this.loadingBar.style.border = '1px solid rgba(90,225,255,0.40)';
    this.loadingBar.style.borderRadius = '18px';
    this.loadingBar.style.boxShadow = '0 14px 38px rgba(0,0,0,0.50), inset 0 0 22px rgba(41,190,255,0.12)';
    this.loadingBar.style.position = 'fixed';
    this.loadingBar.style.left = '50%';
    this.loadingBar.style.top = '50%';
    this.loadingBar.style.transform = 'translate(-50%, -50%)';
    this.loadingBar.style.padding = '14px 16px';
    this.loadingBar.style.zIndex = '4';

    this.title.style.height = '30px';
    this.title.style.lineHeight = '30px';
    this.title.style.fontSize = '16px';
    this.title.style.letterSpacing = '1.2px';
    this.title.style.fontWeight = '700';
    this.title.style.textTransform = 'uppercase';
    this.title.innerHTML = 'Bootstrapping Atmospheric Engine';

    this.underBar.style.width = '100%';
    this.underBar.style.height = '52px';
    this.underBar.style.lineHeight = '24px';
    this.underBar.style.fontSize = '13px';
    this.underBar.style.color = '#9bd9ff';

    this.bar.style.height = '48px';
    this.bar.style.lineHeight = '44px';
    this.bar.style.borderRadius = '12px';
    this.bar.style.background = 'linear-gradient(90deg, #1c79ff, #27d2ff, #54f0e2)';
    this.bar.style.boxShadow = '0 0 20px rgba(45,215,255,0.35)';
    this.bar.style.fontSize = '20px';
    this.bar.style.fontWeight = '700';

    this.#update();

    document.body.appendChild(this.loadingBar);
  }

  async add(num, text)
  {
    this.percent += num;
    this.description = text;
    await this.#update();
  }

  async set(num, text)
  {
    this.percent = num;
    this.description = text;
    await this.#update();
  }

  async showError(error)
  {
    this.bar.style.backgroundColor = 'red';
    this.description = error;
    await this.#update();
  }

  #update()
  {
    return new Promise((resolve) => {
      this.bar.style.width = this.percent + '%';
      this.bar.innerHTML = this.percent + '%';
      this.underBar.innerHTML = (this.description || 'Compiling shaders, preparing terrain, and calibrating weather physics') + '<br><span style="font-size:11px;color:#9ad0ff">Device: ' + getDeviceInfoSummary() + '</span>';
      let timeout;
      if (this.percent == 100)
        timeout = 5;
      else
        timeout = 5; // 50 for nicer feel
      setTimeout(() => { resolve(); }, timeout);
    });
  }

  remove() { this.loadingBar.parentNode.removeChild(this.loadingBar); }
}


function setLoadingBar()
{
  return new Promise((resolve) => {
    var element = document.getElementById('IntroScreen');
    var navEl = document.querySelector('.main-nav');
    if (element) {
      element.style.display = 'none';
      element.style.pointerEvents = 'none';
      if (element.parentNode)
        element.parentNode.removeChild(element); // remove introscreen div
    }
    if (navEl)
      navEl.style.display = 'none';

    document.body.style.backgroundColor = '#050b17';

    loadingBar = new LoadingBar(1);

    setTimeout(() => { resolve(); }, 10);
  });
}


function ensureTornadoLabel()
{
  if (tornadoLabelEl)
    return tornadoLabelEl;

  tornadoLabelEl = document.createElement('div');
  tornadoLabelEl.style.position = 'fixed';
  tornadoLabelEl.style.zIndex = '3';
  tornadoLabelEl.style.pointerEvents = 'none';
  tornadoLabelEl.style.padding = '4px 8px';
  tornadoLabelEl.style.borderRadius = '8px';
  tornadoLabelEl.style.border = '1px solid rgba(180,220,255,0.7)';
  tornadoLabelEl.style.background = 'rgba(8,14,30,0.72)';
  tornadoLabelEl.style.color = '#d8f0ff';
  tornadoLabelEl.style.font = '12px monospace';
  tornadoLabelEl.style.display = 'none';
  tornadoLabelEl.innerText = '🌪 Tornado Signature';
  document.body.appendChild(tornadoLabelEl);
  return tornadoLabelEl;
}

function updateTornadoLabel()
{
  const label = ensureTornadoLabel();
  if (!guiControls.showTornadoLabels || SETUP_MODE || guiControls.tornadoPotential < 0.15 || frameNum % 20 != 0) {
    label.style.display = 'none';
    return;
  }

  let best = 0.0;
  let bestX = 0;
  let bestY = 0;
  const samples = 28;
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  const px = new Float32Array(4);
  for (let i = 0; i < samples; i++) {
    const sx = Math.floor((i / samples) * (sim_res_x - 1));
    const sy = Math.floor(sim_res_y * 0.05 + (Math.sin(i * 2.73 + frameNum * 0.03) * 0.5 + 0.5) * sim_res_y * 0.28);
    gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.FLOAT, px);
    const vx = px[0];
    const vy = px[1];
    const buoy = Math.max(px[3] - 290.0, 0.0);
    const strength = Math.abs(vx * vy) + Math.max(vy, 0.0) * 0.7 + buoy * 0.0006;
    if (strength > best) {
      best = strength;
      bestX = sx;
      bestY = sy;
    }
  }

  if (best > 0.0035) {
    label.style.display = 'block';
    label.style.left = (simToScreenX(bestX) + 8) + 'px';
    label.style.top = (simToScreenY(bestY) - 16) + 'px';
    label.innerText = '🌪 Tornado Signature  ' + (best * 1000.0).toFixed(1);
  } else {
    label.style.display = 'none';
  }
}

var soundingData;

async function prepareSounding()
{
  const dateSel = getEl('datePicker');
  const date = new Date(dateSel && dateSel.value ? dateSel.value : Date.now());
  let epochTime = Math.floor(date.getTime() / 1000);

  const hourSelector = getEl('hourSelector');
  const hour = hourSelector && hourSelector.selectedIndex >= 0 ? hourSelector.options[hourSelector.selectedIndex].value : 0;

  epochTime += hour * 3600;

  soundingData = await loadSounding(stationSelector.options[stationSelector.selectedIndex].value, epochTime);
}

function triggerLightningEffects(lightningX, lightningY, intensity)
{
  let camXnorm = 1.0 - (cam.curXpos + 1.0) / 2.0;

  let camDistFromSim = cellHeight * sim_res_x * 0.5 / cam.curZoom; // asuming 90° HFOV

  let camHorDistFromStrike = (lightningX - camXnorm) * cellHeight * sim_res_x;

  let vecStrikeToCam = new Vec2D(camDistFromSim, camHorDistFromStrike);
  let distance = vecStrikeToCam.mag();

  // shock wave travel time (same physical model as thunder)
  let delaySec = distance / 343.0;
  let simTimeMult = timePerIteration * guiControls.IterPerFrame * FPS * 3600.0;
  let delayFrames = Math.max(Math.floor((delaySec / simTimeMult) * FPS), 0);

  let lightningTemperature = map_range_C(intensity, 0.05, 4.5, 9000.0, 32000.0);

  pendingLightningShakeEvents.push({
    delayFrames : delayFrames,
    horizontalSign : camHorDistFromStrike < 0.0 ? -1.0 : 1.0,
    distance : distance,
    intensity : Math.max(intensity, 0.01),
    temperature : lightningTemperature,
  });

  if (pendingLightningShakeEvents.length > 64)
    pendingLightningShakeEvents.shift();
}

function updateLightningShakePhysics()
{
  if (!guiControls.cameraShake) {
    lightningShakeOffsetX = lightningShakeOffsetY = 0.0;
    lightningShakeHFOffsetX = lightningShakeHFOffsetY = 0.0;
    lightningShakeVelocityX = lightningShakeVelocityY = 0.0;
    lightningShakeHFAmplitude = 0.0;
    lightningShakePhaseX = lightningShakePhaseY = 0.0;
    pendingLightningShakeEvents.length = 0;
    return;
  }
  for (let i = pendingLightningShakeEvents.length - 1; i >= 0; i--) {
    let event = pendingLightningShakeEvents[i];
    event.delayFrames--;

    if (event.delayFrames <= 0) {
      let distanceMult = map_range_C(event.distance, 500.0, 30000.0, 1.0, 0.0);
      let thermalBoost = map_range_C(event.temperature, 9000.0, 32000.0, 0.85, 1.45) * guiControls.lightningTempShakeMult;
      let impulse = clamp(Math.pow(event.intensity, 0.60) * 0.030 * distanceMult * thermalBoost, 0.0, 0.028);

      // apply shock mostly horizontal with slight random vertical jitter
      lightningShakeVelocityX += event.horizontalSign * impulse;
      lightningShakeVelocityY += (Math.random() - 0.5) * impulse * 0.35;

      // high frequency shake burst for close/intense lightning
      lightningShakeHFAmplitude = clamp(lightningShakeHFAmplitude + impulse * 4.2, 0.0, 0.034);

      pendingLightningShakeEvents.splice(i, 1);
    }
  }

  // disable low-frequency/glide shake so lightning camera motion stays high-frequency only
  lightningShakeVelocityX = 0.0;
  lightningShakeVelocityY = 0.0;
  lightningShakeOffsetX = 0.0;
  lightningShakeOffsetY = 0.0;

  // high-frequency lightning jitter with configurable frequency and faster decay
  lightningShakeHFAmplitude *= guiControls.shakeDecay;

  lightningShakePhaseX += (4.8 + Math.random() * 1.8) * guiControls.shakeFrequency;
  lightningShakePhaseY += (5.6 + Math.random() * 2.2) * guiControls.shakeFrequency;

  let hfNoiseX = (Math.random() * 2.0 - 1.0) * 0.35;
  let hfNoiseY = (Math.random() * 2.0 - 1.0) * 0.35;

  lightningShakeHFOffsetX = (Math.sin(lightningShakePhaseX) + hfNoiseX) * lightningShakeHFAmplitude;
  lightningShakeHFOffsetY = (Math.sin(lightningShakePhaseY) + hfNoiseY) * lightningShakeHFAmplitude;

  lightningShakeOffsetX = clamp(lightningShakeOffsetX, -0.025, 0.025);
  lightningShakeOffsetY = clamp(lightningShakeOffsetY, -0.020, 0.020);
}


async function mainScript(initialBaseTex, initialWaterTex, initialWallTex, initialRainDrops)
{


  await setLoadingBar();

  let lastSaveTime = new Date();

  class Camera
  {
    #spring = 0.02;   // 0.02
    #damp = 0.70;     // 0.70
    wrapHorizontally; // bool
    smooth;           // bool
    curXpos;
    curXposLin;
    curYpos;
    curZoom;
    tarXpos;
    tarYpos;
    tarZoom;
    #Xvel;
    #Yvel;
    #Zvel;

    constructor()
    {
      this.curXpos = 0;
      this.curXposLin = 0;
      this.curYpos = -0.5 + sim_res_y / sim_res_x; // viewYpos = -0.5 + sim_res_y / sim_res_x;// match bottem of sim area to bottem of screen
      this.curZoom = 1.0001;
      this.tarXpos = 0;
      this.tarYpos = -0.5 + sim_res_y / sim_res_x;
      this.tarZoom = 1.0001;
      this.wrapHorizontally = true;
      this.smooth = true;
      this.#Xvel = 0;
      this.#Yvel = 0;
      this.#Zvel = 0;
    }

    center()
    {
      this.tarXpos = this.curXpos = this.curXposLin = 0.0;
      this.tarYpos = this.curYpos = -0.5 + sim_res_y / sim_res_x;
      this.tarZoom = this.curZoom = 1.0001;
      this.#Xvel = 0;
      this.#Yvel = 0;
      this.#Zvel = 0;
    }

    changeCurXpos(change)
    {
      this.curXposLin = this.curXposLin + change;
      this.curXpos = mod(this.curXposLin + 1.0, 2.0) - 1.0;
    }

    setPosition(x, y, zoom)
    {
      this.curXpos = this.tarXpos = x;
      this.curYpos = this.tarYpos = y;

      if (zoom)
        this.curZoom = this.tarZoom = zoom;
    }

    move()
    {
      let xDif = this.tarXpos - this.curXposLin;
      let yDif = this.tarYpos - this.curYpos;
      let zoomDif = this.tarZoom - this.curZoom;
      if (this.smooth) {
        this.#Xvel += xDif * this.#spring;
        this.#Xvel *= this.#damp;
        this.changeCurXpos(this.#Xvel);

        this.#Yvel += yDif * this.#spring;
        this.#Yvel *= this.#damp;
        this.curYpos += this.#Yvel;

        this.#Zvel += zoomDif * this.#spring;
        this.#Zvel *= this.#damp;
        this.curZoom += this.#Zvel;
      } else {
        this.changeCurXpos(xDif);
        this.curYpos += yDif;
        this.curZoom += zoomDif;
      }

      if (guiControls.sound && !guiControls.paused) {
        soundSystem.updateAmbientSound(this.curXpos, this.curYpos, this.curZoom);
      }
    }

    changeViewZoom(change)
    {
      this.tarZoom *= 1.0 + change;

      let minZoom = 0.5;
      let maxZoom = 35.0 * sim_aspect;

      if (this.tarZoom > maxZoom) {
        this.tarZoom = maxZoom;
        return false;
      } else if (this.tarZoom < minZoom) {
        this.tarZoom = minZoom;
        return false;
      } else {
        return true;
      }
    }

    changeViewXpos(change)
    {
      this.tarXpos += change;
      if (!this.wrapHorizontally)
        this.tarXpos = clamp(this.tarXpos, -0.99, 0.99);
    }

    changeViewYpos(change) { this.tarYpos = clamp(this.tarYpos + change, -2.50, 0.50); }

    zoomAtMousePos(delta)
    {
      if (cam.changeViewZoom(delta)) {
        // zoom center at mouse position
        var mousePositionZoomCorrectionX = (((mouseX - canvas.width / 2 + this.tarXpos) * delta) / cam.tarZoom / canvas.width) * 2.0;
        var mousePositionZoomCorrectionY = ((((mouseY - canvas.height / 2 + this.tarYpos) * delta) / cam.tarZoom / canvas.height) * 2.0) / canvas_aspect;
        this.changeViewXpos(-mousePositionZoomCorrectionX);
        this.changeViewYpos(mousePositionZoomCorrectionY);
      }
    }
  }

  cam = new Camera();

  class JetEngineSoundGenerator
  {
    constructor(ctx) { this.audioCtx = ctx; }

    createSource(bufferSize)
    {
      const bufferSource = this.audioCtx.createBufferSource();
      bufferSource.buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
      return bufferSource;
    }

    createLowNoiseSource()
    {
      const bufferSize = 20 * this.audioCtx.sampleRate;
      const bufferSource = this.createSource(bufferSize);
      const data = bufferSource.buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 2)
        data[i] = Math.random() * 2 - 1;
      for (let i = 1; i < bufferSize - 1; i += 2)   // Fill in the gaps
        data[i] = (data[i - 1] + data[i + 1]) / 2.; // average of surrounding samples
      return bufferSource;
    }

    start()
    {
      // High-pitch turbine whine
      this.lowWhine = this.audioCtx.createOscillator();
      this.lowWhine.type = "sine";
      this.lowWhineGain = this.audioCtx.createGain();

      this.highWhine = this.audioCtx.createOscillator();
      this.highWhine.type = "sine";
      this.highWhineGain = this.audioCtx.createGain();

      // low rumble noise
      this.lowNoiseSource = this.createLowNoiseSource();
      this.lowNoiseSource.loop = true;
      this.lowNoiseFilter = this.audioCtx.createBiquadFilter();
      this.lowNoiseFilter.type = "lowpass";
      this.lowNoiseFilter.Q.value = 5.5;
      this.lowNoiseGain = this.audioCtx.createGain();

      // stereo pan
      this.pan = this.audioCtx.createStereoPanner();

      // Master mix
      this.mix = this.audioCtx.createGain();
      this.mix.gain.value = 0.;

      // Connect graph
      this.lowWhine.connect(this.lowWhineGain).connect(this.mix);
      this.highWhine.connect(this.highWhineGain).connect(this.mix);
      this.lowNoiseSource.connect(this.lowNoiseFilter).connect(this.lowNoiseGain).connect(this.mix);
      this.mix.connect(this.pan).connect(this.audioCtx.destination);

      // Start
      this.lowWhine.start();
      this.highWhine.start();
      this.lowNoiseSource.start();
    }

    update(N1, dist, horizontalAngle)
    {
      const rpm = N1 * 7000;
      const whineFreq = 100 + rpm * 1.0; // 300 + rpm * 0.8;
      const noiseFreq = N1 * 600;        // 200 + N1 * 300;

      this.lowWhine.frequency.value = whineFreq / 2.;
      this.highWhine.frequency.value = whineFreq;
      this.lowNoiseFilter.frequency.value = noiseFreq;

      const airVol = Math.sqrt(N1) * 3.;
      const whineVol = Math.sqrt(Math.min(N1, 0.3)) * 0.005;

      this.lowNoiseGain.gain.value = airVol;
      this.lowWhineGain.gain.value = whineVol;
      this.highWhineGain.gain.value = whineVol;

      dist += 1.0; // prevent devide by 0

      this.pan.pan.value = -horizontalAngle / 90.;
      this.mix.gain.value = 170.0 / dist;
    }

    mute() { this.mix.gain.value = 0.; }

    stop()
    {
      this.mix.gain.value = 0;
      this.lowWhine.stop();
      this.highWhine.stop();
      this.lowNoiseSource.stop();
    }
  }

  class SoundSystem
  {
    audioCtx;
    jetEngineSound;

    thunderCCSounds = [];
    thunderCGSounds = [];

    urban_sound;
    forest_sound;
    beach_sound;
    rain_sound;
    wind_sound;


    constructor()
    {
      this.audioCtx = new window.AudioContext();
      this.jetEngineSound = new JetEngineSoundGenerator(this.audioCtx);
      // load sound files asynchronously
      this.loadThunderSounds('cc', 13).then(buffers => { this.thunderCCSounds = buffers; });
      this.loadThunderSounds('cg', 13).then(buffers => { this.thunderCGSounds = buffers; });

      this.loadSound('urban.m4a').then(buffer => { this.urban_sound = this.playLoop(buffer, 0.0); });
      this.loadSound('forest.mp3').then(buffer => { this.forest_sound = this.playLoop(buffer, 0.0); });
      this.loadSound('beach.mp3').then(buffer => { this.beach_sound = this.playLoop(buffer, 0.0); });
      this.loadSound('rain.m4a').then(buffer => { this.rain_sound = this.playLoop(buffer, 0.0); });
      this.loadSound('wind.m4a').then(buffer => { this.wind_sound = this.playLoop(buffer, 0.0); });
    }

    async loadSound(url)
    {
      const resp = await fetch('resources/sounds/' + url);
      const arrayBuffer = await resp.arrayBuffer();
      return await this.audioCtx.decodeAudioData(arrayBuffer);
    }

    async loadThunderSounds(name, num)
    {
      const soundPromises = [];
      for (let i = 1; i <= num; i++) {
        const filename = name + `${i}.m4a`;
        soundPromises.push(this.loadSound(filename));
      }
      return await Promise.all(soundPromises);
    }

    soundThunder(x, y, intensity)
    {
      let camXnorm = 1. - (cam.curXpos + 1.0) / 2.0;

      let camDistFromSim = cellHeight * sim_res_x * 0.5 / cam.curZoom; // asuming 90° HFOV

      let camHorDistFromStrike = (x - camXnorm) * cellHeight * sim_res_x;

      let vecStrikeToCam = new Vec2D(camDistFromSim, camHorDistFromStrike);

      let distance = vecStrikeToCam.mag();

      let leftRightBalance = -vecStrikeToCam.angle();

      // console.log(camDistFromSim, camHorDistFromStrike, distance, leftRightBalance);

      // Speed of sound ≈ 343 m/s
      let soundDelay = distance / 343;                                            // in seconds

      let simTimeMult = timePerIteration * guiControls.IterPerFrame * FPS * 3600; // how much faster sime time is than real time

      soundDelay /= simTimeMult;

      let soundArray = intensity > 1.0 ? this.thunderCGSounds : this.thunderCCSounds;
      let randomThunderSound = soundArray[Math.floor(Math.random() * soundArray.length)];
      this.playOnce(randomThunderSound, intensity / (distance * 0.001), leftRightBalance, soundDelay);
    }

    playOnce(buffer, volume = 1, leftRightBalance = 0, delay = 0)
    {
      const src = this.audioCtx.createBufferSource();
      const gain = this.audioCtx.createGain();
      const pan = this.audioCtx.createStereoPanner();
      src.buffer = buffer;
      src.loop = false;
      gain.gain.value = volume;
      pan.pan.value = clamp(leftRightBalance, -1., 1.);
      src.connect(gain).connect(pan).connect(this.audioCtx.destination);
      src.start(this.audioCtx.currentTime + delay);
    }

    playLoop(buffer, volume = 1, leftRightBalance = 0)
    {
      const src = this.audioCtx.createBufferSource();
      const gain = this.audioCtx.createGain();
      const pan = this.audioCtx.createStereoPanner();
      src.buffer = buffer;
      src.loop = true;
      gain.gain.value = volume;
      pan.pan.value = clamp(leftRightBalance, -1., 1.);
      src.connect(gain).connect(pan).connect(this.audioCtx.destination);
      src.start();
      return {gain : gain.gain, pan : pan.pan};
    }

    updateAmbientSound(Xpos, Ypos, zoom)
    {
      let camDistFromSim = cellHeight * sim_res_x * 0.5 / zoom; // asuming 90° HFOV

      if (camDistFromSim < 5000) {

        const sampleWidth = Math.floor(clamp(camDistFromSim / cellHeight * 3, 30, 200)); // sample just a litte wider than the fov
        const sampleWidth_2 = Math.floor(sampleWidth / 2);
        const sampleWidth_3 = Math.floor(sampleWidth / 3);

        let simXpos = Math.floor((-Xpos + 1) * 0.5 * sim_res_x);
        let simYpos = clamp(Math.floor((-Ypos * sim_aspect + 1) * 0.5 * sim_res_y), 0, sim_res_y - 1);

        gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
        gl.readBuffer(gl.COLOR_ATTACHMENT2); // walltexture
        var wallTextureValues = new Int8Array(4 * sampleWidth);
        gl.readPixels(simXpos - sampleWidth_2, simYpos, sampleWidth, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues);

        let cellsAboveSurface = wallTextureValues[sampleWidth_2 * 4 + 2];

        let camHeightAboveSurface = cellsAboveSurface * cellHeight;

        let vecCamToSurface = new Vec2D(camDistFromSim, camHeightAboveSurface);

        let distanceToSurface = vecCamToSurface.mag();

        let forest = new Vec2D();
        let beach = new Vec2D();
        let urban = new Vec2D();

        let distVolumeMult = map_range_C(1.0 / (clamp(distanceToSurface, 1000, 5000) / 1000.0), 0.2, 1.0, 0.0, 1.0); // multiplier based on camera distance to surface

        for (let i = 0; i < sampleWidth; i++) {

          let Lgain = clamp((sampleWidth_3 - Math.abs(i - sampleWidth_3)) / (sampleWidth_3 * sampleWidth_3), 0., 1.);
          let Rgain = clamp((sampleWidth_3 - Math.abs(i - sampleWidth_3 * 2)) / (sampleWidth_3 * sampleWidth_3), 0., 1.);
          let gain = new Vec2D(Lgain, Rgain);

          if (wallTextureValues[i * 4 + 0] == 1) { // land vegetation
            let vegetationNorm = wallTextureValues[i * 4 + 3] / 127.0;
            forest.add(gain.mult(vegetationNorm));
          } else if (wallTextureValues[i * 4 + 0] == 2) {                                      // water
            beach.add(gain);
          } else if (wallTextureValues[i * 4 + 0] == 4 || wallTextureValues[i * 4 + 0] == 6) { // urban or industrial
            urban.add(gain);
          }
        }

        forest.mult(distVolumeMult * 0.15);
        beach.mult(distVolumeMult * 1.0);
        urban.mult(distVolumeMult * 1.0);

        this.setSoundLeftRight(this.forest_sound, forest.x, forest.y);
        this.setSoundLeftRight(this.beach_sound, beach.x, beach.y);
        this.setSoundLeftRight(this.urban_sound, urban.x, urban.y);

        // wind sound
        gl.readBuffer(gl.COLOR_ATTACHMENT0); // basetexture
        var baseTextureValues = new Float32Array(4);
        let justAboveSurfaceCellY = simYpos - cellsAboveSurface + 3;
        gl.readPixels(simXpos, justAboveSurfaceCellY, 1, 1, gl.RGBA, gl.FLOAT, baseTextureValues); // read single cell at mouse position

        let windVolume = Math.abs(baseTextureValues[0]) * 10.0;

        windVolume *= distVolumeMult;

        this.setSoundGainAndPan(this.wind_sound, windVolume);

        let tempC = KtoC(potentialToRealT(baseTextureValues[3], justAboveSurfaceCellY));

        // rain sound

        let rainVolume = 0;

        if (tempC > 0) {

          gl.readBuffer(gl.COLOR_ATTACHMENT1); // watertexture
          var waterTextureValues = new Float32Array(4);

          gl.readPixels(simXpos, justAboveSurfaceCellY, 1, 1, gl.RGBA, gl.FLOAT, waterTextureValues);

          rainVolume = Math.pow(waterTextureValues[2] * 0.5, 0.5);

          rainVolume *= map_range_C(tempC, 0., 3., 0., 1.); // rain sound fades as temperature approaches 0 (wet snow)

          rainVolume *= distVolumeMult;
        }

        this.setSoundGainAndPan(this.rain_sound, rainVolume);

        //    console.log(distVolumeMult, rainVolume, windVolume);
      }

      if (airplaneMode) {
        let camXnorm = 1. - (cam.curXpos + 1.0) / 2.0;
        let camYnorm = 1. - (cam.curYpos * sim_aspect + 1.0) / 2.0;

        //    console.log(camXnorm, airplane.phys.pos.x);

        const vecCamToPlaneOnFlatSimArea = airplane.phys.pos.copy().subtract(new Vec2D(camXnorm * cellHeight * sim_res_x, camYnorm * cellHeight * sim_res_y));

        const distCamToPlane = new Vec2D(vecCamToPlaneOnFlatSimArea.mag(), camDistFromSim).mag();

        const horizontalAngleCamToPlane = new Vec2D(camDistFromSim, vecCamToPlaneOnFlatSimArea.x).angle() * radToDeg;

        this.jetEngineSound.update(airplane.getN1(), distCamToPlane, horizontalAngleCamToPlane);
      }
    }

    setSoundLeftRight(sound, L, R)
    {
      let gain = Math.max(L, R);
      if (gain == 0) {
        this.setSoundGainAndPan(sound, 0, 0);
        return;
      }
      let pan = (R - L) / gain;
      this.setSoundGainAndPan(sound, gain, pan);
    }

    setSoundGainAndPan(sound, gain, pan = 0.0)
    {
      if (sound) {
        sound.gain.value = gain;
        sound.pan.value = pan;
      }
    }

    mute()
    {
      this.setSoundGainAndPan(this.forest_sound, 0);
      this.setSoundGainAndPan(this.beach_sound, 0);
      this.setSoundGainAndPan(this.urban_sound, 0);
      this.setSoundGainAndPan(this.rain_sound, 0);
      this.setSoundGainAndPan(this.wind_sound, 0);
      this.jetEngineSound.mute();
    }
  }

  // AIRPLANE

  class PIDController
  {
    #previousValue;
    #previousError;
    integral;

    constructor(kp, ki, kd, iThreshold)
    {
      this.kp = kp; // Proportional gain
      this.ki = ki; // Integral gain
      this.kd = kd; // Derivative gain
      this.iThreshold = iThreshold;
      this.resetState();
    }

    resetState()
    {
      this.#previousValue = 0;
      this.#previousError = 0;
      this.integral = 0;
    }

    update(setpoint, measuredValue)
    {
      const error = setpoint - measuredValue;

      const derivative = error - this.#previousError;

      let integralActive =
        this.iThreshold == null || (Math.abs(error) < this.iThreshold && Math.abs(derivative) < this.iThreshold / 100.); // only adjust integral if already close and stable to target

      if (integralActive)
        this.integral += error;
      else
        this.integral = 0;

      this.#previousError = error;
      this.#previousValue = measuredValue;

      let totalOutput = this.kp * error + this.kd * derivative;

      if (integralActive) {
        totalOutput += this.ki * this.integral;
      }

      return totalOutput;
    }
  }

  class Autopilot
  {
    mode;
    autoThrottleEnabled;
    targetPitch;
    targetAltitude;
    targetIAS;
    targetGlideslope;

    // dependencies:
    #instrumentPanel;
    #airplane;

    constructor(airplane)
    {
      this.#airplane = airplane;
      // PID for altitude to pitch
      this.altitudePID = new PIDController(0.04, 0.00003, 20.0, 100.0);
      // PID for pitch to elevator
      this.pitchPID = new PIDController(0.4, 0.001, 20.0, 5.0, true); // 0.5, 0.001, 100.0

      this.speedPID = new PIDController(0.05, 0.00005, 1.0, 10.0);

      // PID for glideslope to pitch
      this.glideslopePID = new PIDController(2.0, 0.0015, 5.0, 3.0);

      this.targetPitch = 0.0;
      this.targetAltitude = 5000.0;
      this.targetIAS = 0.0;
      this.mode = 'ALTITUDE';

      this.autoThrottleEnabled = false;

      this.targetGlideslope = -3.0;
    }

    bindInstrumentPanel(instrumentPanel) { this.#instrumentPanel = instrumentPanel; }

    setMode(mode) { this.mode = mode; }

    setAutoThrottle(ATHR_state) { this.autoThrottleEnabled = ATHR_state; }

    resetState()
    {
      this.altitudePID.resetState();
      this.pitchPID.resetState();
      this.speedPID.resetState();
      this.glideslopePID.resetState();
    }

    update(pitchAttitude, altitude, trueVel, IAS, vecToRunway, gearOnGround)
    {
      let targetIAS = this.targetIAS;

      switch (this.mode) {

      case 'ALTITUDE':
        this.targetPitch = clamp(this.altitudePID.update(this.targetAltitude, altitude) + 3.0, -6.0, 10.0); // add 3.0 degree pitch bias

        this.targetPitch *= 1.0 - Math.abs(trueVel.y) * 0.03;                                               // limit vertical speed

        break;
      case 'AUTOLAND':

        if (vecToRunway.x <= 4000) {
          this.#airplane.setGear(true);
        }

        let currentGlideslope = trueVel.angle() * radToDeg;
        let adjustedTargetGlideslope = 0.0;

        if (vecToRunway.x <= 200) {
          adjustedTargetGlideslope = Math.max((vecToRunway.y - 10) * -0.08, -2.0); // flare
          // targetGlideslope = Math.max(targetGlideslope, currentGlideslope); // prevent acelerating down when entering at shallow angle
          targetIAS = 0.0;

        } else {

          let slopeToRunway = vecToRunway.angle() * radToDeg;

          adjustedTargetGlideslope = this.targetGlideslope + clamp((slopeToRunway - this.targetGlideslope) * 3.0, -5.0, 3.0); // move towards ideal glideslope

          targetIAS = map_range_C(vecToRunway.x, 2000, 15000, 95, 128);                                                       // target speed depend on distance to runway
          this.#instrumentPanel.setTargetIAS(msToKnots(targetIAS));
        }

        this.targetPitch = clamp(this.glideslopePID.update(adjustedTargetGlideslope, currentGlideslope) + 0.0, -6.0, 10.0);

        break;
      }


      let throttle = clamp(this.speedPID.update(targetIAS, IAS) + 0.60, 0.0, 1.0); // add 60% thrust bias

      // console.log(this.targetAltitude, altitude, this.targetPitch);

      let elevator = clamp(this.pitchPID.update(this.targetPitch, pitchAttitude) + 0.2, -1.0, 1.0);


      if (gearOnGround) {
        elevator = 0.40;
        throttle = -1.0;
      }

      //  console.log(this.#desiredPitch, pitchAttitude, elevator);

      return [ elevator, throttle ];
    }
  }

  class N1Indicator
  {
    container;
    percentText;
    fillArc;
    arcLength;

    constructor(parentElement)
    {
      this.container = document.createElement('div');
      this.container.innerHTML += `
          <svg class="gauge" viewBox="0 90 320 90" aria-hidden="true">
            <path class="bg-arc" d="M40 140 A120 120 0 0 1 280 140" />
            <path id="fillArc" class="fill-arc" d="M40 140 A120 120 0 0 1 280 140" />
            <text id="percentText" x="160" y="140" class="value">0%</text>
          </svg>
      `;

      this.percentText = this.container.querySelector('#percentText');
      this.fillArc = this.container.querySelector('#fillArc');

      this.arcLength = this.fillArc.getTotalLength();
      this.fillArc.style.strokeDasharray = this.arcLength + ' ' + this.arcLength;
      this.fillArc.style.strokeDashoffset = this.arcLength;

      parentElement.appendChild(this.container);
    }

    getColor(p)
    {
      if (p < 80) {
        const ratio = p / 80;
        const r = Math.round(0 + ratio * 255);
        const g = 255;
        return `rgb(${r},${g},0)`;
      } else if (p < 100) {
        const ratio = (p - 90) / 10;
        const r = 255;
        const g = Math.round(255 - ratio * 155);
        return `rgb(${r},${g},0)`;
      } else {
        return `rgb(255,0,0)`;
      }
    }

    update(N1)
    {
      const p = N1 * 100.;
      this.percentText.textContent = p.toFixed(1) + '%';
      this.fillArc.style.stroke = this.getColor(p);
      const offset = this.arcLength * (1 - p / 100);
      this.fillArc.style.strokeDashoffset = offset;
    }
  }

  class InstrumentPanel
  {
    #instrumentCanvas;
    #panelImg;
    #targetAltInput;
    #targetIASInput;
    #targetGlideslopeInput;
    #autolandButton;
    #autoThrottleButton;
    #altHoldButton;
    #panelDiv;
    #N1Indicator;

    // dependencies:
    #autopilot

    constructor(autopilot)
    {
      this.#autopilot = autopilot;
      this.#panelDiv = document.createElement('div');
      this.#instrumentCanvas = document.createElement('canvas');
      this.#instrumentCanvas.width = 800;
      this.#instrumentCanvas.height = 660;
      this.#panelDiv.style.opacity = 0.7;
      this.#panelDiv.style.position = 'absolute';
      this.#panelDiv.style.bottom = 0;
      this.#panelDiv.style.right = 0;
      this.#panelDiv.style.left = 'auto';
      this.loadImages();
      this.genAutopilotBar(this.#panelDiv);
      this.#panelDiv.appendChild(this.#instrumentCanvas);
      body.appendChild(this.#panelDiv);
    }

    setDisplaySideRight(right)
    {
      if (right) {
        this.#panelDiv.style.right = 0;
        this.#panelDiv.style.left = 'auto';
      } else { // left
        this.#panelDiv.style.right = 'auto';
        this.#panelDiv.style.left = 0;
      }
    }

    setMode_AUTOLAND(on)
    {
      if (on) {
        this.#autopilot.setMode('AUTOLAND');
        this.#altHoldButton.checked = false;
      } else {
        this.#autopilot.setMode('NONE');
      }
    }

    setMode_ALTITUDE(on)
    {
      if (on) {
        this.#autopilot.setMode('ALTITUDE');
        this.#autolandButton.checked = false;
      } else {
        this.#autopilot.setMode('NONE');
      }
    }

    setAutoThrottle(ATHR_state) { this.#autopilot.setAutoThrottle(ATHR_state); }

    genAutopilotBar(panelDiv)
    {
      const container = document.createElement('div');

      const speedLabel = document.createElement('label');
      speedLabel.style = 'position: absolute; left: 10px;';

      this.#targetIASInput = document.createElement('input');
      this.#targetIASInput.type = 'number';
      this.#targetIASInput.id = 'speed';
      this.#targetIASInput.className = 'autopilotNumberInput';
      this.#targetIASInput.min = '0';
      this.#targetIASInput.max = '330';
      this.#targetIASInput.step = '5';
      this.#targetIASInput.value = '220';
      this.#targetIASInput.style = 'width: 150px;';
      this.#targetIASInput.addEventListener('wheel', (e) => { e.stopPropagation(); });
      this.#targetIASInput.addEventListener('keydown', (e) => { e.stopPropagation(); });
      speedLabel.appendChild(this.#targetIASInput);

      const speedSpan = document.createElement('span');
      speedSpan.textContent = 'KT';
      speedSpan.style = 'position: absolute; right: 100px;';
      speedLabel.appendChild(speedSpan);
      container.appendChild(speedLabel);

      this.#autoThrottleButton = document.createElement('input');
      this.#autoThrottleButton.type = 'checkbox';
      this.#autoThrottleButton.id = 'athr';
      this.#autoThrottleButton.className = 'airbus-switch';
      this.#autoThrottleButton.addEventListener('change', () => this.setAutoThrottle(this.#autoThrottleButton.checked));
      container.appendChild(this.#autoThrottleButton);

      let athrLabel = document.createElement('label');
      athrLabel.htmlFor = 'athr';
      athrLabel.className = 'airbus-label';
      athrLabel.innerHTML = 'A/THR';
      athrLabel.style = 'position: absolute; left: 200px;';
      container.appendChild(athrLabel);

      this.#N1Indicator = new N1Indicator(container);

      const glideSlopeLabel = document.createElement('label');
      glideSlopeLabel.style = 'position: absolute; left: 420px;';

      this.#targetGlideslopeInput = document.createElement('input');
      this.#targetGlideslopeInput.type = 'number';
      this.#targetGlideslopeInput.id = 'targetGlideSlopeInput';
      this.#targetGlideslopeInput.className = 'autopilotNumberInput';
      this.#targetGlideslopeInput.name = 'altitude';
      this.#targetGlideslopeInput.min = '2';
      this.#targetGlideslopeInput.max = '6';
      this.#targetGlideslopeInput.step = '1';
      this.#targetGlideslopeInput.value = '3';
      this.#targetGlideslopeInput.style.width = '55px';
      this.#targetGlideslopeInput.addEventListener('wheel', (e) => { e.stopPropagation(); });
      this.#targetGlideslopeInput.addEventListener('keydown', (e) => { e.stopPropagation(); });
      glideSlopeLabel.appendChild(this.#targetGlideslopeInput);

      const glidSlopeSpan = document.createElement('span');
      glidSlopeSpan.textContent = '°';
      glidSlopeSpan.style = 'position: absolute; right: 20px;';
      glideSlopeLabel.appendChild(glidSlopeSpan);
      container.appendChild(glideSlopeLabel);

      this.#autolandButton = document.createElement('input');
      this.#autolandButton.type = 'checkbox';
      this.#autolandButton.id = 'autoland';
      this.#autolandButton.className = 'airbus-switch';
      this.#autolandButton.addEventListener('change', e => {this.setMode_AUTOLAND(e.target.checked)});
      container.appendChild(this.#autolandButton);

      let autolandLabel = document.createElement('label');
      autolandLabel.htmlFor = 'autoland';
      autolandLabel.className = 'airbus-label';
      autolandLabel.innerHTML = 'LAND';
      autolandLabel.style = 'position: absolute; left: 500px;';
      container.appendChild(autolandLabel);

      this.#altHoldButton = document.createElement('input');
      this.#altHoldButton.type = 'checkbox';
      this.#altHoldButton.id = 'althold';
      this.#altHoldButton.className = 'airbus-switch';
      this.#altHoldButton.addEventListener('change', e => {this.setMode_ALTITUDE(e.target.checked)});
      container.appendChild(this.#altHoldButton);

      let altLabel = document.createElement('label');
      altLabel.htmlFor = 'althold';
      altLabel.className = 'airbus-label';
      altLabel.innerHTML = 'ALT';
      altLabel.style = 'position: absolute; left: 600px;';
      container.appendChild(altLabel);


      const targetAltitudeLabel = document.createElement('label');

      this.#targetAltInput = document.createElement('input');
      this.#targetAltInput.type = 'number';
      this.#targetAltInput.id = 'altitude';
      this.#targetAltInput.className = 'autopilotNumberInput';
      this.#targetAltInput.name = 'altitude';
      this.#targetAltInput.min = '0';
      this.#targetAltInput.max = '40000';
      this.#targetAltInput.step = '100';
      this.#targetAltInput.value = '10000';
      this.#targetAltInput.style.width = '55px';
      this.#targetAltInput.style = 'position: absolute; left: 670px;';
      this.#targetAltInput.addEventListener('wheel', (e) => { e.stopPropagation(); });
      this.#targetAltInput.addEventListener('keydown', (e) => { e.stopPropagation(); });
      targetAltitudeLabel.appendChild(this.#targetAltInput);

      const targetAltSpan = document.createElement('span');
      targetAltSpan.textContent = 'ft';
      targetAltSpan.style = 'position: absolute; right: 70px;';
      targetAltitudeLabel.appendChild(targetAltSpan);

      container.appendChild(targetAltitudeLabel);


      container.style = 'height: 60px; display: flex; justify-content: space-between; align-items: center; background-color: #222222; color: white';

      panelDiv.appendChild(container);

      this.setMode_ALTITUDE();
    }

    setTargetIAS(targetIAS) { this.#targetIASInput.value = targetIAS.toFixed(0); }


    getTargetAlt() { return this.#targetAltInput.value / mToFt; }
    getTargetIAS() { return knotsToMs(this.#targetIASInput.value); }
    getTargetGlideslope() { return -this.#targetGlideslopeInput.value; }

    remove()
    {
      this.#instrumentCanvas.remove();
      this.#panelDiv.remove()
    }

    async loadImages() { this.#panelImg = await loadImage('resources/img/Panel.png'); }

    async display(pitchAngle, airAngle, altitude, radarAltitude, IAS, trueVel, OAT_C, throttle, N1, elevator, targetPitch, autopilotEn, gearStatus, runwayPointer, vecToRunway, brake)
    {
      let ctx = this.#instrumentCanvas.getContext('2d');
      let width = this.#instrumentCanvas.width - 50;
      let height = this.#instrumentCanvas.height;
      const topBarHeight = 50;
      let mainHeight = height - topBarHeight; // height of virtual horizon part

      let targetAltitude = this.getTargetAlt();
      let targetIAS = this.getTargetIAS();

      // ATTITUDE INDICATOR / VIRTUAL HORIZON:

      const pixPerDeg = 15.0;

      let y0 = mainHeight / 2 + topBarHeight + pitchAngle * pixPerDeg; // y pos of 0 deg pitch line

      ctx.beginPath();
      ctx.rect(0, -1000, width, 1000 + y0);
      ctx.fillStyle = '#05A3ED'; // blue
      ctx.fill();
      ctx.beginPath();
      ctx.rect(0, y0, width, 1500);
      ctx.fillStyle = '#F0843C'; // brown
      ctx.fill();


      ctx.strokeStyle = 'white';
      ctx.fillStyle = 'white';
      ctx.beginPath();
      for (let i = Math.round((pitchAngle) / 10) * 10 - 50; i < pitchAngle + 50; i += 2.5) {
        let y = y0 - i * pixPerDeg;
        if (i % 10 == 0) {
          ctx.moveTo(width / 2 - width * 0.15, y);
          ctx.lineTo(width / 2 + width * 0.15, y);
          if (i != 0) {
            ctx.fillText(i, width / 2 - width * 0.25, y + 12);
            ctx.fillText(i, width / 2 + width * 0.21, y + 12);
          }
        } else if (i % 5 == 0) {
          ctx.moveTo(width / 2 - width * 0.075, y);
          ctx.lineTo(width / 2 + width * 0.075, y);
        } else { // 2.5 deg
          ctx.moveTo(width / 2 - width * 0.0375, y);
          ctx.lineTo(width / 2 + width * 0.0375, y);
        }
      }
      ctx.stroke();
      ctx.strokeStyle = 'yellow';
      ctx.beginPath();
      let moveIndY = mainHeight / 2 + topBarHeight + (pitchAngle - trueVel.angle() * radToDeg) * pixPerDeg; // airAngle
      ctx.moveTo(width / 2 - width * 0.15, moveIndY);
      ctx.lineTo(width / 2 + width * 0.15, moveIndY);
      ctx.stroke();

      ctx.strokeStyle = 'green';
      ctx.beginPath();
      let targIndY = mainHeight / 2 + topBarHeight + (pitchAngle - targetPitch) * pixPerDeg;
      ctx.moveTo(width / 2 - width * 0.15, targIndY);
      ctx.lineTo(width / 2 + width * 0.15, targIndY);
      ctx.stroke();

      if (vecToRunway.x < 150000) {
        ctx.strokeStyle = 'blue';
        ctx.beginPath();
        let runwayIndY = mainHeight / 2 + topBarHeight + (pitchAngle - runwayPointer) * pixPerDeg;
        ctx.moveTo(width / 2 - width * 0.15, runwayIndY);
        ctx.lineTo(width / 2 + width * 0.15, runwayIndY);
        ctx.stroke();
        ctx.fillStyle = 'blue';
        ctx.font = '20px serif';
        ctx.fillText(printDistance(vecToRunway.x), width / 2 - width * 0.15 - 70, runwayIndY - 5);
        ctx.fillText(printDistance(vecToRunway.y + 7.5), width / 2 + width * 0.15, runwayIndY - 5);
        ctx.fillText((vecToRunway.angle() * radToDeg).toFixed(1) + ' °', width / 2 + width * 0.23, runwayIndY - 5);
      }

      if (this.#panelImg)
        ctx.drawImage(this.#panelImg, 0, topBarHeight, width, mainHeight);

      // ALTITUDE INDICATOR:

      const altIndXpos = 640; // pos of vertical line

      ctx.beginPath();
      ctx.moveTo(altIndXpos, topBarHeight);
      ctx.lineTo(altIndXpos, height);
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'white';
      ctx.fillStyle = 'white';
      ctx.stroke();
      ctx.font = '30px serif';

      let unit = ' m'

      if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL')
      {
        altitude *= mToFt;
        radarAltitude *= mToFt;
        targetAltitude *= mToFt;
        unit = ' ft'
      }

      const pxPerAlt = 0.65;
      const altRange = 500; // + and -

      ctx.beginPath();
      for (let i = Math.round((altitude - altRange) / 100) * 100; i < altitude + altRange; i += 50) {
        let y = mainHeight / 2 + topBarHeight - (i - altitude) * pxPerAlt;
        if (i % 100 == 0) {
          ctx.moveTo(altIndXpos, y);
          ctx.lineTo(altIndXpos + 20, y);
          ctx.fillText(i, altIndXpos + 25, y + 12);
        } else {
          ctx.moveTo(altIndXpos, y);
          ctx.lineTo(altIndXpos + 10, y);
        }
      }
      ctx.stroke();
      ctx.fillStyle = 'black';
      ctx.fillRect(altIndXpos - 3, mainHeight / 2 + topBarHeight - 25, 113, 50);
      ctx.fillStyle = 'white';
      ctx.fillText(altitude.toFixed(0) + unit, altIndXpos, mainHeight / 2 + topBarHeight + 10);

      // Show ground level
      ctx.beginPath();
      ctx.fillStyle = '#aa0000aa';
      ctx.fillRect(altIndXpos - 3, mainHeight / 2 + topBarHeight + radarAltitude * pxPerAlt, 100, 500);

      // Show target altitude
      ctx.beginPath();
      let targetAltY = mainHeight / 2 + topBarHeight + (altitude - targetAltitude) * pxPerAlt;
      ctx.moveTo(altIndXpos, targetAltY);
      ctx.lineTo(altIndXpos + 100, targetAltY);
      ctx.strokeStyle = 'green';
      ctx.stroke();

      // VELOCITY INDICATOR:
      const velIndXpos = 110;
      ctx.beginPath();
      ctx.moveTo(velIndXpos, topBarHeight);
      ctx.lineTo(velIndXpos, height);
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'white';
      ctx.fillStyle = 'white';
      ctx.stroke();
      ctx.font = '30px serif';

      let stallSpeed = 70.0; // m/s
      let overSpeed = 173.0; // m/s

      if (guiControls.speedUnit == 'SPEED_UNIT_KT') {
        IAS = msToKnots(IAS);
        targetIAS = msToKnots(targetIAS);
        stallSpeed = msToKnots(stallSpeed);
        overSpeed = msToKnots(overSpeed);
        unit = ' kt'
      } else {
        unit = ' km/h'
        IAS *= 3.6; // convert m/s to km/h
        targetIAS *= 3.6;
        stallSpeed *= 3.6;
        overSpeed *= 3.6;
      }

      const pxPerVel = 10.0;
      const velRange = 35; // + and -

      ctx.beginPath();
      for (let i = Math.max(Math.round((IAS) / 10) * 10 - velRange, 0); i < IAS + velRange; i += 5) {
        let y = mainHeight / 2 + topBarHeight - (i - IAS) * pxPerVel;
        if (i % 10 == 0) {
          ctx.moveTo(velIndXpos - 20, y);
          ctx.lineTo(velIndXpos, y);
          ctx.fillText(i, 0, y + 12);
        } else {
          ctx.moveTo(velIndXpos - 10, y);
          ctx.lineTo(velIndXpos, y);
        }
      }
      ctx.stroke();
      ctx.fillStyle = 'black';
      ctx.fillRect(0, mainHeight / 2 + topBarHeight - 25, velIndXpos + 3, 50);
      ctx.fillStyle = 'white';
      ctx.fillText(IAS.toFixed(0) + unit, 0, mainHeight / 2 + topBarHeight + 10);

      // Show stall speed
      ctx.beginPath();
      ctx.fillStyle = '#aa0000aa';
      ctx.fillRect(0, mainHeight / 2 + topBarHeight + (IAS - stallSpeed) * pxPerVel, velIndXpos + 3, 5000);

      // Show over speed
      ctx.beginPath();
      ctx.fillStyle = '#aa0000aa';
      ctx.fillRect(0, mainHeight / 2 + topBarHeight + (IAS - overSpeed) * pxPerVel - 5000, velIndXpos + 3, 5000);

      // Show target IAS
      ctx.beginPath();
      let targetIasY = mainHeight / 2 + topBarHeight + (IAS - targetIAS) * pxPerVel;
      ctx.moveTo(0, targetIasY);
      ctx.lineTo(velIndXpos + 3, targetIasY);
      ctx.strokeStyle = 'green';
      ctx.stroke();

      // VERTICAL VElOCITY INDICATOR
      ctx.fillStyle = 'black';
      ctx.fillRect(width, topBarHeight, 50, mainHeight);
      let hue = clamp(120.0 + trueVel.y * 10.0, 0.0, 200.0);
      ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;

      let verticalSpeedIndicatorVal = trueVel.y < 0 ? Math.sqrt(-trueVel.y) : -Math.sqrt(trueVel.y);
      ctx.fillRect(width + 10, mainHeight / 2 + topBarHeight, 30, verticalSpeedIndicatorVal * 40.);

      ctx.fillStyle = 'black';
      ctx.fillRect(width, mainHeight / 2 + topBarHeight - 13, 50, 26);

      const [veloStr, unitStr] = printVerticalVelocity(trueVel.y);

      ctx.font = '20px serif';
      ctx.fillStyle = 'white';
      ctx.fillText(veloStr, width, mainHeight / 2 + topBarHeight + 6);
      ctx.fillText(unitStr, width + 10, mainHeight / 2 + topBarHeight + 22);

      // OVERHEAD
      ctx.fillStyle = '#222222';
      ctx.fillRect(0, 0, this.#instrumentCanvas.width, topBarHeight);

      ctx.fillStyle = '#00FFFF';
      ctx.font = '30px serif';
      ctx.fillText('🌡 ' + printTemp(OAT_C), 0, 40);

      ctx.fillStyle = '#FFFF00';
      ctx.fillText('🎚️ ' + throttle.toFixed() + ' %', 140, 40);

      this.#N1Indicator.update(N1);

      let gearStatusIndicator = '';
      if (gearStatus == 'UP') {
        gearStatusIndicator = 'UP';
        ctx.fillStyle = '#444444';
      } else if (gearStatus == 'EXTENDING' || gearStatus == 'RETRACTING') {
        gearStatusIndicator = 'UNLK';
        ctx.fillStyle = '#FF0000';
      } else if (gearStatus == 'DOWN') {
        gearStatusIndicator = '▽▽▽';
        ctx.fillStyle = '#00FF00';
      }
      ctx.fillText(gearStatusIndicator, 290, 40);


      let AOA = pitchAngle - airAngle;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('∠ ' + AOA.toFixed(1) + '°', 410, 40);

      if (AOA > 14.0) {
        ctx.fillStyle = '#FF0000';
        ctx.fillText('STALL!', 605, 40);
      }

      if (autopilotEn) {
        ctx.fillStyle = '#00FF00';
        ctx.fillText('AP', 540, 40);
      }

      if (IAS > overSpeed) {
        ctx.fillStyle = '#FF0000';
        ctx.fillText('Overspeed!', 605, 40);
      }

      // BELOW VIRTUAL HORIZON

      ctx.fillStyle = '#AAA';
      ctx.fillText('GS: ' + printVelocity(trueVel.mag()), 130, 640);

      if (brake) {
        ctx.fillStyle = '#F00';
        ctx.fillText('BRAKE', 340, 640);
      }

      ctx.fillStyle = '#AAA';
      ctx.fillText('ELE: ' + elevator.toFixed(2), 500, 640);
    }
  }


  const dt = 1. / FPS;

  class PhysicsObject
  {        // 2D PhysicsObject
    m;     // mass in kg
    I;     // moment of inertia
    pos;   // in meters
    vel;   // in m/s
    angle; // radians
    aVel;  // angular velocity in rad/s

    constructor(m, I, x, y, vx, vy)
    {
      this.m = m;
      this.I = I;
      this.pos = new Vec2D(x, y);
      this.vel = new Vec2D(vx, vy);
      this.angle = 0.0;
      this.aVel = 0.0;
    }

    applyAcceleration(a) { this.vel.add(a.mult(dt)); }

    applyForce(F, pos) // position relative to center
    {
      F.mult(dt);
      this.vel.add(F.copy().div(this.m)); // simply apply force at center of mass
      if (pos != null) {                  // apply torque if force not applied at the center of mass

        let angleToCm = pos.angle();      // angle to center of mass

                                          // console.log(F);
        F.rotate(-angleToCm); // make force vector perpendicular to vector to center off mass

                              // console.log('After rotating ', F, angleToCm * radToDeg);

        let torque = -F.y * pos.mag(); // if force perpendicular to vector from center, mult by dist from center
        this.aVel += torque / this.I;
      }
    }

    move(directionIsLeft)
    {
      let movementPerFrame = this.vel.copy();
      movementPerFrame.mult(dt);
      if (!directionIsLeft)
        movementPerFrame.x = -movementPerFrame.x;
      this.pos.add(movementPerFrame);
      this.pos.x = mod(this.pos.x, sim_res_x * cellHeight); // make sure airplane position stays within sim area
      this.angle += this.aVel * dt;                         // rotate
    }
  }

  class JetEngine
  {
    N1;     // 0. to 1.
    thrust; // 0. to 1.
    starting;
    started;

    constructor()
    {
      this.N1 = 0.186;
      this.starting = false;
      this.started = true;
    }

    toggle()
    {
      if (this.started) {
        this.stop();
      } else {
        this.start();
      }
    }

    start()
    {
      if (!this.started) {
        this.starting = true;
      }
    }

    stop()
    {
      this.started = false;
      this.starting = false;
    }

    update(throttle)
    {
      if (this.starting) {
        this.N1 += 0.00008;
        this.N1 *= 1.006;
        if (this.N1 >= 0.15) {
          this.starting = false;
          this.started = true;
        }
      } else if (this.started)
        this.N1 += (Math.abs(throttle) + 0.223) * 0.0042;

      this.N1 *= 0.995; // drag

      this.thrust = Math.pow(this.N1, 2.0);

      return throttle < 0. ? this.thrust * -0.7 : this.thrust;
    }
  }

  class Airplane
  {
    #instrumentPanel;
    #autopilot;

    directionIsLeft; // false means right

    #relVelAngle;    // angle of velocity relative to air
    #airspeed;       // true airspeed, m/s
    #groundSpeed;
    #IAS;            // indicated airspeed, m/s
    #camFollow;
    #OAT;            // outdoor air temperature

    #radarAltitude;  // meters above ground
    #framesSinceCrash;
    #gearExtPos;     // down: 0.0  up: 7.0
    #gearOnGround;   // if the wheels are touching the ground
    #braking;

    #runwayThresholdPos;

    // Controls
    elevator;
    throttle;
    prevThrottle;

    #gearStatus; // UP EXTENDING DOWN RETRACTING
    #autopilotEnabled;

    jetEngine;

    phys; // physics object, containing all physical properties including position and velocity

    getClosestRunwayPos()
    {
      let Xpos = Math.floor(mod(this.phys.pos.x / cellHeight, sim_res_x));
      // let Ypos = Math.floor(clamp(this.phys.pos.y / cellHeight + 1.0, 100, sim_res_y - 1));

      let Ypos = 90;

      // console.log(Ypos);

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
      gl.readBuffer(gl.COLOR_ATTACHMENT2); // walltexture
      var wallTextureValues = new Int8Array(sim_res_x * 4);
      gl.readPixels(0, Ypos, sim_res_x, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues);

      if (this.directionIsLeft) {
        let x = Xpos - 1;
        while (x != Xpos) {
          if (x < 0)
            x = sim_res_x - 1;

          if (wallTextureValues[x * 4 + 0] == 5) // found runway
          {
            return new Vec2D(x * cellHeight, (Ypos - wallTextureValues[x * 4 + 2]) * cellHeight + 15);
          }
          x--;
        }
      } else { // direction is right
        let x = Xpos + 1;
        while (x != Xpos) {
          if (x > sim_res_x - 1)
            x = 0;

          if (wallTextureValues[x * 4 + 0] == 5) // found runway
          {
            return new Vec2D(x * cellHeight, (Ypos - wallTextureValues[x * 4 + 2]) * cellHeight + 15);
          }
          x++;
        }
      }
      return new Vec2D(0, 0);
    }

    constructor()
    {
      this.#camFollow = true;
      this.phys = new PhysicsObject(1, 1, 0, 0);
      this.phys.pos.x = -99.0;
      this.phys.pos.y = -99.0;
      this.#IAS = 0.0;
      this.#OAT = 0.0;
      this.#airspeed = 0.0;
      this.#groundSpeed = 0.0;
      this.#autopilotEnabled = false;
      this.#gearOnGround = false;
      this.#braking = false;
      this.#runwayThresholdPos = new Vec2D(0, 0);
    }

    toggleCamFollow()
    {
      if (airplaneMode)
        this.#camFollow = !this.#camFollow;
    }

    enableAirplaneMode(autopilotEn)
    {
      this.#autopilot = new Autopilot(this);
      this.setAutopilot(autopilotEn);
      this.#instrumentPanel = new InstrumentPanel(this.#autopilot);
      this.#autopilot.bindInstrumentPanel(this.#instrumentPanel);
      airplaneMode = true;
      this.directionIsLeft = true; // left
      this.#camFollow = true;
      let M = 400 * 1000;          // mass: 400 tons
      let L = 50.0;                // effective length in meters
      let I = 1 / 12 * M * L * L;  // moment of inertia

      let simXpos = Math.floor(mouseXinSim * sim_res_x);
      let simYpos = findSimYposAboveSurfaceAtMouseX();

      let startsOnSurface = simYpos > (mouseYinSim * sim_res_y); // It is placed above the mouse position

      let planePosX = simXpos * cellHeight;
      let planePosY = Math.min(simYpos * cellHeight - (startsOnSurface ? 32.0 : 0.0), 15000.0);

      let velX = startsOnSurface ? 0.0 : map_range_C(mouseYinSim, 0.0, 1.0, -100.0, -200);

      this.phys = new PhysicsObject(M, I, planePosX, planePosY, velX, 0.0);
      this.phys.angle = startsOnSurface ? 0.0 : 5.0 * degToRad;
      this.throttle = startsOnSurface ? 0.00 : 0.40; // %

      if (startsOnSurface) {
        this.#gearStatus = 'DOWN';
        this.#gearExtPos = 0.0;
      } else {
        this.#gearStatus = 'UP';
        this.#gearExtPos = 7.0;

        this.#runwayThresholdPos = this.getClosestRunwayPos();
      }

      cam.tarZoom = 100.0;

      this.jetEngine = new JetEngine();
      soundSystem.jetEngineSound.start();
    }

    changeDirection()
    {
      if (this.directionIsLeft) {
        if (!confirm('Do you want to change the flight direction to Right?'))
          return;
      } else {
        if (!confirm('Do you want to change the flight direction to Left?'))
          return;
      }
      this.directionIsLeft = !this.directionIsLeft;
      this.#instrumentPanel.setDisplaySideRight(this.directionIsLeft);
      this.#runwayThresholdPos = this.getClosestRunwayPos();
    }

    disableAirplaneMode()
    {
      airplaneMode = false;
      this.#framesSinceCrash = -1;
      this.phys.pos.x = -99.0;
      this.phys.pos.y = -99.0;
      this.#camFollow = false;
      this.display(); // run display function one more time to update uniforms
      this.#instrumentPanel.remove();
      document.body.style.cursor = 'default';
      soundSystem.jetEngineSound.stop();
    }

    getN1() { return this.jetEngine ? this.jetEngine.N1 : 0.0; }

    onUpPressed()
    {
      if (this.throttle == 0.) {
        this.throttle = +0.01;
      }
    }

    onDownPressed()
    {
      if (this.throttle == 0.) {
        this.throttle = -0.01;
      }
    }

    setBrakes(enabled) { this.#braking = enabled; }

    toggleEngine() { this.jetEngine.toggle(); }

    toggleGear() { this.setGear(this.#gearStatus == 'UP'); }

    setGear(boolDown)
    {
      if (boolDown) {
        if (this.#gearStatus == 'UP')
          this.#gearStatus = 'EXTENDING';

      } else {
        if (this.#gearStatus == 'DOWN')
          this.#gearStatus = 'RETRACTING';
      }
    }

    // https://aviation.stackexchange.com/questions/64490/is-there-a-simple-relationship-between-angle-of-attack-and-lift-coefficient/97747#97747?newreg=547ea95b1d784abf993b7d1850dcc938
    Cl(AOA) // lift coefficient https://www.desmos.com/calculator/aeeizqvarp
    {
      let lift = 0.0;
      if ((AOA > 0. && AOA < PI / 7.23) || (AOA > 7. / 8.124 * PI && AOA < PI)) {
        lift = Math.sin(6. * AOA);
      } else {
        lift = Math.sin(2. * AOA);
      }
      return lift;
    }

    Cd(AOA) // drag coefficient
    {
      return 1.0 - Math.cos(2 * AOA);
    }

    move()
    {
      if (this.#framesSinceCrash >= 0) {
        this.#framesSinceCrash++;
        if (this.#framesSinceCrash > 30)
          this.disableAirplaneMode();
        return;
      }

      let Xpos = mod(this.phys.pos.x / cellHeight - 1., sim_res_x);
      let Ypos = Math.min(this.phys.pos.y / cellHeight + 1.0, sim_res_y - 1);

      let fractX = fract(Xpos);
      let fractY = fract(Ypos);

      Xpos = Math.floor(Xpos);
      Ypos = Math.floor(Ypos);

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);                                   // basetexture
      var baseTextureValues = new Float32Array(4 * 2 * 2);
      gl.readPixels(Xpos, Ypos, 2, 2, gl.RGBA, gl.FLOAT, baseTextureValues); // order bottem up: x0y0 x1y0 x0y1 x1y1

      let temperature = KtoC(potentialToRealT(baseTextureValues[3], Ypos));

      function fract(f) { return f % 1.; }
      function mix(x, y, a) { return x * (1. - a) + y * a; }

      function bilerp(array, ind, fractX, fractY) // ind: index of value in array to get
      {
        let top = mix(array[2 * 4 + ind], array[3 * 4 + ind], fractX);
        let bottem = mix(array[0 * 4 + ind], array[1 * 4 + ind], fractX);
        return mix(bottem, top, fractY);
      }


      // Linearly interpolatate velocity
      let Vx = bilerp(baseTextureValues, 0, fractX, fractY);
      let Vy = bilerp(baseTextureValues, 1, fractX, fractY);

      let airVel = new Vec2D(this.directionIsLeft ? Vx : -Vx, Vy);

      if (this.phys.pos.y > guiControls.simHeight) {
        airVel.mult(0.0);              // still air above sim area
      } else {
        airVel.mult(cellHeight * 3.6); // convert to m/s
      }

      this.#OAT = temperature;

      // gl.readBuffer(gl.COLOR_ATTACHMENT1); // watertexture
      // var waterTextureValues = new Float32Array(4);
      // gl.readPixels(Xpos, Ypos, 1, 1, gl.RGBA, gl.FLOAT, waterTextureValues);
      // let dewpoint = KtoC(dewpoint(waterTextureValues[0]));

      gl.readBuffer(gl.COLOR_ATTACHMENT2);
      var wallTextureValues = new Int8Array(4 * 3 * 1);
      gl.readPixels(Xpos, Ypos, 3, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues);

      // wrap arround the edge of the sim area
      if (Xpos == sim_res_x - 2) {
        gl.readPixels(0, Ypos, 1, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues.subarray(2 * 4));
      } else if (Xpos == sim_res_x - 1) {
        gl.readPixels(0, Ypos, 2, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues.subarray(1 * 4));
      }

      let radarAltL = (wallTextureValues[0 * 4 + 2] + fractY - 1.) * cellHeight;
      let radarAltM = (wallTextureValues[1 * 4 + 2] + fractY - 1.) * cellHeight;
      let radarAltR = (wallTextureValues[2 * 4 + 2] + fractY - 1.) * cellHeight;


      let radarAltFrontGear = this.directionIsLeft ? mix(radarAltL, radarAltM, Math.min(fractX + 0.14, 1.)) : mix(radarAltM, radarAltR, Math.min(fractX, 1.));

      this.#radarAltitude = Math.min(mix(radarAltL, radarAltM, fractX), mix(radarAltM, radarAltR, fractX));

      // console.log(Xpos, Ypos, radarAltL.toFixed(1), radarAltM.toFixed(1), radarAltR.toFixed(1), fractX);

      if (this.#gearStatus == 'EXTENDING') {
        this.#gearExtPos = Math.max(this.#gearExtPos - 0.01, 0.0);
        if (this.#gearExtPos == 0.0)
          this.#gearStatus = 'DOWN';
      } else if (this.#gearStatus == 'RETRACTING') {
        this.#gearExtPos = Math.min(this.#gearExtPos + 0.01, 7.0);
        if (this.#gearExtPos == 7.0)
          this.#gearStatus = 'UP';
      }

      let heightAboveGround = this.#radarAltitude;

      let heightAboveObstacles = radarAltM;

      let gearTouchAlt = 8.0 - this.#gearExtPos;

      let bounceForceMult = 100000.0;

      if (wallTextureValues[1 * 4 + 0] == 1) { // over land

        let treeHeight = map_range_C(wallTextureValues[1 * 4 + 3], 80, 127, 0., 15.);
        heightAboveObstacles -= treeHeight;

      } else if (wallTextureValues[1 * 4 + 0] == 2) { // over water
        heightAboveObstacles += 20.;
        gearTouchAlt = -5.0;                          // + (7.0 - this.#gearExtPos) * 0.2;
        bounceForceMult = 9000.0 + Math.abs(this.phys.vel.x) * 600.0;

        let draught = gearTouchAlt - heightAboveGround;
        if (draught > 0.0) {
          let waterDragForce = this.phys.vel.x * -50000.0 * draught;
          // console.log(waterDragForce);
          if (waterDragForce > 3000000 || this.#gearExtPos < 7.0) { // crash on water
            guiControls.IterPerFrame = 1;
            guiControls.auto_IterPerFrame = false;
            this.#framesSinceCrash = 0;
            soundSystem.jetEngineSound.stop();
          }

          this.phys.applyForce(new Vec2D(waterDragForce, 0.));

          this.jetEngine.stop();
        }

      } else if (wallTextureValues[1 * 4 + 0] == 4) { // over urban
        heightAboveObstacles -= 80.0;
      }

      let mainGearForce = Math.max(gearTouchAlt - heightAboveGround, 0.0) * bounceForceMult * 100.0;

      if (mainGearForce > 0.0) {
        this.#gearOnGround = true;
        mainGearForce -= this.phys.vel.y * 500000; // damping
      } else {
        this.#gearOnGround = false;
      }

      this.phys.applyForce(new Vec2D(0.0, mainGearForce), new Vec2D(1., 0.));

      let frontGearPosX = 36.0;                                                         // m

      let frontGearAlt = radarAltFrontGear + Math.sin(this.phys.angle) * frontGearPosX; // front gear altitude is not completely acurate yet

      let frontGearForce = Math.max(gearTouchAlt - frontGearAlt, 0.0) * bounceForceMult * 5.0;

      if (frontGearForce > 0.0)
        frontGearForce -= this.phys.aVel * 5000000; // damping

      this.phys.applyForce(new Vec2D(0.0, -frontGearForce), new Vec2D(-frontGearPosX, 0.));

      let gearPos = clamp(-(heightAboveGround - gearTouchAlt), 0.0, 5.0) + this.#gearExtPos; // 0 is all the way down, positive is up into the airplane

      gl.useProgram(skyBackgroundDisplayProgram);
      gl.uniform2f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'planeDirectionAndGearPos'), this.directionIsLeft, gearPos);

      if (wallTextureValues[0] != 2 && (heightAboveObstacles < 6.0 || radarAltL < 6.0 || (heightAboveObstacles < 10.0 && Math.abs(this.phys.angle) > 0.25))) { // crash into the surface
        guiControls.IterPerFrame = 1;
        guiControls.auto_IterPerFrame = false;
        this.#framesSinceCrash = 0;
        soundSystem.jetEngineSound.stop();
      }

      this.#groundSpeed = this.phys.vel.mag();

      let relVel = this.phys.vel.copy().subtract(airVel);           // velocity relative to air
      this.#airspeed = relVel.mag();                                // true airspeed in m/s
      let relAlt = this.phys.pos.y / 12000.0;                       // 12000 m = 1.0
      let relAirDensity = Math.pow(1. - relAlt * 0.47, 2.0);        // 1.0 is sea level, 0.28 is 12000 meters
      let relIndVel = relVel.copy().mult(Math.sqrt(relAirDensity)); // convert velocity relative to air to indicated, wich is also what the airplane feels

      this.#IAS = relIndVel.mag();

      // this.phys.angle += this.elevator * 0.001; // simple pitch control for testing

      // this.#relVelAngle = this.phys.vel.angle(); // ignore air movement for testing
      this.#relVelAngle = relVel.angle();


      let AOA = this.phys.angle - this.#relVelAngle;
      let dynamicPressMult = relIndVel.magSq(); // dynamic pressure
      let liftForce = this.Cl(AOA) * dynamicPressMult * 800.0;
      let dragForce = this.Cd(AOA) * dynamicPressMult * 800.0;

      // console.log(Math.round(liftForce, 1), Math.round(dragForce, 1));
      // console.log((liftForce / dragForce).toFixed(1));
      // console.log(Math.abs(this.phys.vel.x));

      let mainWingForce = new Vec2D(dragForce, liftForce);
      mainWingForce.rotate(this.#relVelAngle);
      this.phys.applyForce(mainWingForce); // Apply Main wing force at center off mass

      // console.log('this.elevator ' + this.elevator);

      let vertStabilAOA = AOA - (this.elevator * 15.0 + 3.0) * degToRad; // angled at -12 to 18 degrees relative to main wing with 3 deg center position

      // console.log('vertStabilAOA ', vertStabilAOA * radToDeg);

      let vertStabilPos = new Vec2D(35., 0.); // 35 meters to the right of the center of mass
      vertStabilPos.rotate(this.phys.angle);
      // console.log('vertStabilPos ', vertStabilPos);
      let vertStabilForce = new Vec2D(this.Cd(vertStabilAOA) * dynamicPressMult * 40.0, this.Cl(vertStabilAOA) * dynamicPressMult * 40.0);
      vertStabilForce.rotate(this.#relVelAngle);

      // console.log((vertStabilAOA * radToDeg).toFixed(2), vertStabilForce.copy().div(10000));

      let thrust = this.jetEngine.update(this.throttle);

      let thrustAltMult = 0.5 + relAirDensity * 0.5;

      this.phys.applyForce(vertStabilForce, vertStabilPos);                                        // apply vertical stabiliser force
      this.phys.applyForce(Vec2D.fromAngle(this.phys.angle, thrust * thrustAltMult * 311000 * 4)); // Thrust 4 X 311 kN
      this.phys.applyAcceleration(new Vec2D(0.0, -9.81));                                          // gravity

      let normRelVel = new Vec2D(Math.cos(this.#relVelAngle), Math.sin(this.#relVelAngle));
      let dragMult = (this.#gearStatus == 'UP' ? 25.0 : 35.0) + Math.abs(Math.sin(AOA) * 150.0);
      let dragMag = dynamicPressMult * dragMult;

      this.phys.applyForce(new Vec2D(normRelVel.x * dragMag, -normRelVel.y * dragMag));

      if (this.#gearOnGround) {
        let gearDragForce = (this.#braking ? 1100000.0 : 50000.0); // braking and wheel friction

        this.phys.applyForce(new Vec2D(this.phys.vel.x > 0.0 ? -gearDragForce : gearDragForce, 0.));
      }

      this.phys.aVel *= 1. - 0.15 * dt; // angular velocity drag

      this.phys.move(this.directionIsLeft);
    }

    hasCrashed() { return this.#framesSinceCrash >= 0; }

    setAutopilot(enabledIn)
    {
      document.body.style.cursor = enabledIn ? 'default' : 'crosshair';
      this.#autopilotEnabled = enabledIn;

      if (enabledIn == true) {
        this.#runwayThresholdPos = this.getClosestRunwayPos();
        this.#autopilot.resetState();
        this.#autopilot.targetPitch = this.phys.angle * radToDeg;
      }
    }

    calcVecToRunway()
    {
      if (this.directionIsLeft) {
        let distToRunwayY = this.phys.pos.y - this.#runwayThresholdPos.y;
        let distToRunwayX = 0;
        if (this.phys.pos.x > this.#runwayThresholdPos.x) {               // to the right of runway
          distToRunwayX = this.phys.pos.x - this.#runwayThresholdPos.x;
        } else if (this.phys.pos.x > this.#runwayThresholdPos.x - 3000) { // above runway
          distToRunwayX = 0;
        } else {                                                          // to the left of runway, wrap around map
          distToRunwayX = sim_res_x * cellHeight + (this.phys.pos.x - this.#runwayThresholdPos.x);
        }
        let vecToRunway = new Vec2D(distToRunwayX, distToRunwayY);
        return vecToRunway;
      } else {
        let distToRunwayY = this.phys.pos.y - this.#runwayThresholdPos.y;
        let distToRunwayX = 0;
        if (this.phys.pos.x < this.#runwayThresholdPos.x) {               // to the left of runway
          distToRunwayX = this.#runwayThresholdPos.x - this.phys.pos.x;
        } else if (this.phys.pos.x < this.#runwayThresholdPos.x + 3000) { // above runway
          distToRunwayX = 0;
        } else {                                                          // to the left of runway, wrap around map
          distToRunwayX = sim_res_x * cellHeight + (this.phys.pos.x - this.#runwayThresholdPos.x);
        }
        let vecToRunway = new Vec2D(distToRunwayX, distToRunwayY);
        return vecToRunway;
      }
    }

    takeUserInput()
    {
      this.prevThrottle = this.throttle;

      if (upPressed) {
        this.throttle += 0.01 * guiControls.airplaneThrottleResponse;
      } else if (downPressed) {
        this.throttle -= 0.01 * guiControls.airplaneThrottleResponse;
      }

      const [autopilotElevator, autopilotThrottle] = this.#autopilot.update(this.phys.angle * radToDeg, this.phys.pos.y, this.phys.vel, this.#IAS, this.calcVecToRunway(), this.#gearOnGround);

      this.#autopilot.targetAltitude = this.#instrumentPanel.getTargetAlt();
      this.#autopilot.targetIAS = this.#instrumentPanel.getTargetIAS();
      this.#autopilot.targetGlideslope = this.#instrumentPanel.getTargetGlideslope();

      if (this.#autopilot.autoThrottleEnabled) {
        this.throttle = autopilotThrottle;

        if (this.throttle < 0.0)
          this.#braking = true;
      }

      const gp = navigator.getGamepads()[0];

      if (this.#autopilotEnabled) {

        this.elevator = autopilotElevator;
      } else if (gp) {
        this.elevator = -gp.axes[1];
      } else {                                                              // manual elevator control
        this.elevator = ((mouseY - canvas.height / 2) / canvas.height * 2.0) * guiControls.airplanePitchAuthority; // pitch input -1.0 to +1.0
      }

      // this.elevator /= 1.0 + Math.max(this.#airspeed - 80, 0.) * 0.01;          // limit elevator throw at higher airspeed
      this.elevator += Math.max(-this.phys.angle * radToDeg - 50.0, 0.) * 0.03; // limit elevator to prevent going down steeper than vertical
      this.elevator -= Math.max(this.phys.angle * radToDeg - 50.0, 0.) * 0.03;  // limit elevator to prevent going up steeper than vertical

      // console.log(this.phys.angle * radToDeg, this.elevator);

      if (gp) {
        if (!this.#autopilot.autoThrottleEnabled) {
          this.throttle = (gp.axes[2] + 1.) / 2.;
          this.throttle *= -gp.axes[4]; // reverse thrust
        }
        this.#braking = gp.buttons[0].pressed;

        this.setGear(gp.axes[7] > 0.)
      }

      this.throttle = clamp(this.throttle, (this.#gearOnGround && (this.prevThrottle < 0. || this.#autopilot.autoThrottleEnabled || gp)) ? -0.3 : 0.0,
                            (this.prevThrottle > 0. || this.#autopilot.autoThrottleEnabled || gp) ? 1.0 : 0.0);
    }

    display()
    {
      let normXpos = this.phys.pos.x / cellHeight / sim_res_x;
      let normYpos = (this.phys.pos.y / cellHeight + 1.0) / sim_res_y;

      // console.log(normXpos, normYpos);
      gl.useProgram(skyBackgroundDisplayProgram);
      gl.uniform3f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'planePos'), normXpos, normYpos, this.directionIsLeft ? this.phys.angle : -this.phys.angle);
      gl.useProgram(advectionProgram);
      gl.uniform4f(gl.getUniformLocation(advectionProgram, 'airplaneValues'), normXpos, normYpos, this.throttle, this.#framesSinceCrash > 0 ? 1.0 : (zPressed ? -1.0 : 0.0));
      gl.useProgram(precipitationProgram);
      gl.uniform2f(gl.getUniformLocation(precipitationProgram, 'airplanePosNorm'), mod(normXpos + 1.0, 1.0), clamp(normYpos, 0.0, 1.0));
      gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'airplaneLightningAttractor'), guiControls.airplaneLightningAttractor);
      gl.useProgram(skyBackgroundDisplayProgram);

      if (this.#camFollow) {
        cam.tarXpos = -normXpos * 2.0 + 1.0;
        cam.tarYpos = -normYpos * 2.0 * (sim_res_y / sim_res_x) + (sim_res_y / sim_res_x);
      }

      let vecToRunway = this.calcVecToRunway();

      this.#instrumentPanel.display(this.phys.angle * radToDeg, this.#relVelAngle * radToDeg, this.phys.pos.y, this.#radarAltitude, this.#IAS, this.phys.vel, this.#OAT, this.throttle * 100.0,
                                    this.jetEngine.N1, this.elevator, this.#autopilot.targetPitch, this.#autopilotEnabled, this.#gearStatus, vecToRunway.angle() * radToDeg, vecToRunway,
                                    this.#braking);
    }
  }

  var airplane = new Airplane();

  document.body.style.overflow = 'hidden'; // prevent scrolling bar from apearing

  canvas = getEl('mainCanvas');
  if (!canvas)
    throw ' Error: mainCanvas element not found';

  function resizeCanvasAndPostFx()
  {
    const viewport = window.visualViewport;
    const viewportWidth = viewport ? viewport.width : window.innerWidth;
    const viewportHeight = viewport ? viewport.height : window.innerHeight;
    const scale = clamp(guiControls?.renderScale ?? 1.0, 0.5, 1.5);
    const pixelRatio = getEffectivePixelRatio();
    canvas.width = Math.max(1, Math.floor(viewportWidth * scale * pixelRatio));
    canvas.height = Math.max(1, Math.floor(viewportHeight * scale * pixelRatio));
    canvas.style.width = viewportWidth + 'px';
    canvas.style.height = viewportHeight + 'px';
    if (typeof createBloomFBOs === 'function')
      createBloomFBOs();
    if (typeof createHdrFBO === 'function')
      createHdrFBO();
  }

  var contextAttributes = {
    alpha : false,
    desynchronized : false,
    antialias : true,
    depth : false,
    failIfMajorPerformanceCaveat : false,
    powerPreference : 'high-performance',
    premultipliedAlpha : true, // true
    preserveDrawingBuffer : false,
    stencil : false,
  };
  gl = canvas.getContext('webgl2', contextAttributes);
  // console.log(gl.getContextAttributes());

  if (!gl) {
    const introPanel = getEl('IntroScreen');
    const msg = getEl('WebGLSupportMessage');
    if (msg) {
      msg.textContent = 'WebGL2 is not available on this device/browser. Simulation mode is disabled; please try a modern browser (Safari 16+/Chrome/Firefox).';
      msg.style.display = 'block';
    }
    if (introPanel)
      introPanel.style.display = 'block';
    return;
  }

  // SETUP GUI

  if (guiControlsFromSaveFile == null) { // use default settings
    setupDatGui(JSON.stringify(guiControls_default));
    guiControls.simHeight = sim_height;
    guiControls.globalEffectsEndAlt = sim_height;

    if (startDate) {
      guiControls.month = startDate.getMonth() + 1 + startDate.getDate() / 30.5;
    }

    if (startLatitude) {
      guiControls.latitude = startLatitude;
    }

  } else {
    setupDatGui(guiControlsFromSaveFile);                     // use settings from save file

    for (const [key, value] of Object.entries(guiControls)) { // set numerical values that could not be loaded from the savefile to their defaults.
      if (value === -1) {
        guiControls[key] = guiControls_default[key];
      }
    }
  }

  function setGuiUniforms()
  { // set all uniforms to new values
    if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'vorticity'), guiControls.vorticity);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'landEvaporation'), guiControls.landEvaporation);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterEvaporation'), guiControls.waterEvaporation);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'dynamicWaterTemperature'), guiControls.dynamicWaterTemperature ? 1.0 : 0.0);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'evapHeat'), guiControls.evapHeat);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterWeight'), guiControls.waterWeight);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'precipitationRecycling'), guiControls.precipitationRecycling);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'surfaceRunoffRate'), guiControls.surfaceRunoffRate);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'soilInfiltrationRate'), guiControls.soilInfiltrationRate);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'canopyInterception'), guiControls.canopyInterception);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'urbanHeatIslandStrength'), guiControls.urbanHeatIslandStrength);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'coastalMixing'), guiControls.coastalMixing);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterAlbedoShift'), guiControls.waterAlbedoShift);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'cloudLifetimeBoost'), guiControls.cloudLifetimeBoost);
    gl.useProgram(velocityProgram);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'dragMultiplier'), guiControls.dragMultiplier);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'wind'), guiControls.wind);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'coriolisStrength'), guiControls.coriolisStrength);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'turbulentMix'), guiControls.turbulentMix);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'jetStreamCoupling'), guiControls.jetStreamCoupling);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'gravityWaveDrag'), guiControls.gravityWaveDrag);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'mountainWaveStrength'), guiControls.mountainWaveStrength);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'vortexStretching'), guiControls.vortexStretching);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'ageostrophicFlow'), guiControls.ageostrophicFlow);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'moistBuoyancyBoost'), guiControls.moistBuoyancyBoost);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'gravityCurrentStrength'), guiControls.gravityCurrentStrength);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'shearProduction'), guiControls.shearProduction);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'tornadoPotential'), guiControls.tornadoPotential);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'frontogenesisStrength'), guiControls.frontogenesisStrength);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'supercellHelicity'), guiControls.supercellHelicity);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'mesocycloneFeedback'), guiControls.mesocycloneFeedback);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'stormRelativeInflow'), guiControls.stormRelativeInflow);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'occlusionDowndraftCoupling'), guiControls.occlusionDowndraftCoupling);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'gradientRichardsonMix'), guiControls.gradientRichardsonMix);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'turbulentPrandtl'), guiControls.turbulentPrandtl);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'pblDepthMeters'), guiControls.pblDepthMeters);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'entrainmentFluxBoost'), guiControls.entrainmentFluxBoost);
    gl.useProgram(lightingProgram);
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'waterTemperature'), CtoK(guiControls.waterTemperature));
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'greenhouseGases'), guiControls.greenhouseGases);
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'waterGreenHouseEffect'), guiControls.waterGreenHouseEffect);
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'IR_rate'), guiControls.IR_rate);
    gl.useProgram(advectionProgram);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'evapHeat'), guiControls.evapHeat);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'meltingHeat'), guiControls.meltingHeat);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'condensationRate'), guiControls.condensationRate);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalDrying'), guiControls.globalDrying);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalHeating'), guiControls.globalHeating);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'soundingForcing'), guiControls.soundingForcing);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsStartAlt'), guiControls.globalEffectsStartAlt / guiControls.simHeight);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsEndAlt'), guiControls.globalEffectsEndAlt / guiControls.simHeight);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'waterTemperature'), CtoK(guiControls.waterTemperature));
    const mobileLightningVisibility = getMobileLightningVisibility();
    gl.useProgram(precipitationProgram);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'evapHeat'), guiControls.evapHeat);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'meltingHeat'), guiControls.meltingHeat);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'aboveZeroThreshold'), guiControls.aboveZeroThreshold);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'subZeroThreshold'), guiControls.subZeroThreshold);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'spawnChanceMult'), guiControls.spawnChance);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningChanceMult'), guiControls.lightningChanceMult);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningMinInterval'), guiControls.lightningMinInterval);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'icLightningRatio'), guiControls.icLightningRatio);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'ctgLightningRatio'), guiControls.ctgLightningRatio);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningFlashRate'), guiControls.lightningFlashRate);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningComplexity'), guiControls.lightningComplexity);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'multiStrokeLightning'), guiControls.multiStrokeLightning);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'precipitationEffectMult'), guiControls.precipitationEffectMult);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningGroundBias'), guiControls.lightningGroundBias);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'stormOrganization'), guiControls.stormOrganization);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'aerosolLoad'), guiControls.aerosolLoad);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'entrainmentRate'), guiControls.entrainmentRate);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'downdraftCoolingMult'), guiControls.downdraftCoolingMult);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'microburstStrength'), guiControls.microburstStrength);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningBranching'), guiControls.lightningBranching);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningAnvilDrift'), guiControls.lightningAnvilDrift);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'precipitationSizeSpectrum'), guiControls.precipitationSizeSpectrum);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'hailShatterFactor'), guiControls.hailShatterFactor);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'mobilePrecipBoost'), guiControls.mobilePrecipBoost);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'mobileLightningVisibility'), getMobileLightningVisibility());
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'snowDensity'), guiControls.snowDensity);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'fallSpeed'), guiControls.fallSpeed);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'growthRate0C'), guiControls.growthRate0C);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'growthRate_30C'), guiControls.growthRate_30C);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'freezingRate'), guiControls.freezingRate);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'meltingRate'), guiControls.meltingRate);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'evapRate'), getAdaptiveEvapRate());
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'entrainmentDilution'), guiControls.entrainmentDilution);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'kesslerAutoconversion'), guiControls.kesslerAutoconversion);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'ventilationEvapEnhancement'), guiControls.ventilationEvapEnhancement);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'drizzleThresholdShift'), guiControls.drizzleThresholdShift);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'graupelChargeGain'), guiControls.graupelChargeGain);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'iceCrystalChargeGain'), guiControls.iceCrystalChargeGain);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'stormMoistureLift'), guiControls.stormMoistureLift);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningFrequencyBoost'), guiControls.lightningFrequencyBoost);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'dryLightningAllowance'), guiControls.dryLightningAllowance);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'stormPulseStrength'), guiControls.stormPulseStrength);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningRecoveryBoost'), guiControls.lightningRecoveryBoost);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'airplaneLightningAttractor'), guiControls.airplaneLightningAttractor);
    gl.useProgram(realisticDisplayProgram);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningColorTempMult'), guiControls.lightningColorTempMult);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'electricFieldVizStrength'), guiControls.electricFieldVizStrength);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'dynamicChargeSeparation'), guiControls.dynamicChargeSeparation);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'electricFieldDiffusion'), guiControls.electricFieldDiffusion);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'mobileLightningVisibility'), getMobileLightningVisibility());
    gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'showLightningRods'), guiControls.showLightningRods ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningFlashPersistence'), guiControls.lightningFlashPersistence);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningTempMinK'), guiControls.lightningTempMinK);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningTempMaxK'), guiControls.lightningTempMaxK);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'precipitationVisualBoost'), guiControls.precipitationVisualBoost);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'precipitationTint'), guiControls.precipitationTint);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'precipitationContrast'), guiControls.precipitationContrast);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'ambientScattering'), guiControls.ambientScattering);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'cloudLayerComplexity'), guiControls.cloudLayerComplexity);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningBloomStrength'), guiControls.lightningBloomStrength);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'flashlightIntensity'), guiControls.flashlightIntensity);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'flashlightFocus'), guiControls.flashlightFocus);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'flashlightRange'), guiControls.flashlightRange);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'radiationHaze'), guiControls.radiationHaze);
    gl.useProgram(postProcessingProgram);
    gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), guiControls.exposure);
    updateLightningRodUniforms();
  }

  function updateLightningRodUniforms()
  {
    if (!precipitationProgram || !gl)
      return;

    const maxRods = 8;
    const rodData = new Float32Array(maxRods * 2);
    const rodCount = Math.min(lightningRods.length, maxRods);
    for (let i = 0; i < rodCount; i++) {
      rodData[i * 2] = lightningRods[i].x / sim_res_x;
      rodData[i * 2 + 1] = lightningRods[i].y / sim_res_y;
    }

    const rodRadiusNorm = (guiControls.lightningRodRadiusKm * 1000.0) / Math.max(cellHeight * sim_res_x, 1.0);

    gl.useProgram(precipitationProgram);
    gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'lightningRodCount'), rodCount);
    gl.uniform2fv(gl.getUniformLocation(precipitationProgram, 'lightningRodPos[0]'), rodData);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningRodRadiusNorm'), rodRadiusNorm);
    gl.uniform2f(gl.getUniformLocation(precipitationProgram, 'airplanePosNorm'), -2.0, -2.0);

    gl.useProgram(realisticDisplayProgram);
    gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'lightningRodCount'), rodCount);
    gl.uniform2fv(gl.getUniformLocation(realisticDisplayProgram, 'lightningRodPos[0]'), rodData);
  }

  function setupDatGui(strGuiControls)
  {
    datGui = new dat.GUI();
    const loadedGuiControls = JSON.parse(strGuiControls); // load settings object
    guiControls = Object.assign({}, guiControls_default, loadedGuiControls); // backfill missing keys from older savefiles

    function applyGraphicsPresetSettings(preset)
    {
      if (preset == 'Low') {
        guiControls.renderScale = 0.75;
        guiControls.lightningBloomStrength = 0.70;
        guiControls.precipitationVisualBoost = 0.85;
        guiControls.ambientScattering = 0.80;
      } else if (preset == 'Medium') {
        guiControls.renderScale = 0.90;
        guiControls.lightningBloomStrength = 0.90;
        guiControls.precipitationVisualBoost = 1.0;
        guiControls.ambientScattering = 0.92;
      } else if (preset == 'High') {
        guiControls.renderScale = 1.0;
        guiControls.lightningBloomStrength = 1.0;
        guiControls.precipitationVisualBoost = 1.0;
        guiControls.ambientScattering = 1.0;
      } else {
        guiControls.renderScale = 1.15;
        guiControls.lightningBloomStrength = 1.15;
        guiControls.precipitationVisualBoost = 1.15;
        guiControls.ambientScattering = 1.10;
      }
    }

    function applySimulationProfile(profile)
    {
      if (profile == 'Calm') {
        guiControls.turbulentMix = 0.75;
        guiControls.stormOrganization = 0.75;
        guiControls.lightningChanceMult = 0.0012;
        guiControls.spawnChance = 0.00004;
        guiControls.precipitationEffectMult = 0.9;
      } else if (profile == 'Balanced') {
        guiControls.turbulentMix = 1.0;
        guiControls.stormOrganization = 1.0;
        guiControls.lightningChanceMult = 0.002;
        guiControls.spawnChance = 0.00005;
        guiControls.precipitationEffectMult = 1.0;
      } else if (profile == 'Dynamic') {
        guiControls.turbulentMix = 1.25;
        guiControls.stormOrganization = 1.25;
        guiControls.lightningChanceMult = 0.0032;
        guiControls.spawnChance = 0.00006;
        guiControls.precipitationEffectMult = 1.18;
      } else {
        guiControls.turbulentMix = 1.55;
        guiControls.stormOrganization = 1.45;
        guiControls.lightningChanceMult = 0.0040;
        guiControls.spawnChance = 0.00007;
        guiControls.precipitationEffectMult = 1.30;
      }
      setGuiUniforms();
    }

    if (window.matchMedia && window.matchMedia('(pointer:coarse)').matches)
      guiControls.mobilePrecipBoost = Math.max(guiControls.mobilePrecipBoost, 1.35);

    guiControls.tool = 'TOOL_NONE';

    applyGraphicsPresetSettings(guiControls.graphicsPreset);

    cam.wrapHorizontally = guiControls.wrapHorizontally;
    cam.smooth = guiControls.SmoothCam;

    if (guiControls.wrapHorizontally)
      horizontalDisplayMult = 3.0;
    else
      horizontalDisplayMult = 1.0;


    if (frameNum == 0) {
      // only hide during initial setup. When resetting settings and
      // reinitializing datGui, H key no longer works to unhide it
      datGui.hide();
    }
    // add functions to guicontrols object
    guiControls.download = function() { prepareDownload(); };

    guiControls.recreateSimulation = function() {
      if (!confirm('Recreate the simulation from the current initial setup and terrain?'))
        return;

      setupPrecipitationBuffers();
      setupTextures();
      even = true;
      frameNum = 0;
      iterNum = 0;
      lightningPauseStartFrame = 0;
      lightningPauseStartIter = 0;
      lightningWasPaused = false;
      lightningRods = [];
      pendingLightningPayloads.length = 0;
      pendingLightningTextureWrites.length = 0;
      for (let i = 0; i < weatherStations.length; i++) {
        weatherStations[i].clearChart();
      }
    };

    guiControls.resetSettings = function() {
      if (confirm('Are you sure you want to reset all settings to default?')) {
        datGui.destroy();                                 // remove datGui completely
        setupDatGui(JSON.stringify(guiControls_default)); // generate new one with new settings
        setGuiUniforms();
        hideOrShowGraph();
        updateSunlight();
      }
    };

    var fluidParams_folder = datGui.addFolder('Fluid');

    fluidParams_folder.add(guiControls, 'vorticity', 0.0, 0.010, 0.001)
      .onChange(function() {
        if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'vorticity'), guiControls.vorticity);
      })
      .name('Vorticity');

    fluidParams_folder.add(guiControls, 'dragMultiplier', 0.0, 1.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'dragMultiplier'), guiControls.dragMultiplier);
      })
      .name('Drag');

    fluidParams_folder.add(guiControls, 'wind', -1.0, 1.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'wind'), guiControls.wind);
      })
      .name('Wind');

    fluidParams_folder.add(guiControls, 'coriolisStrength', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'coriolisStrength'), guiControls.coriolisStrength);
      })
      .name('Coriolis Strength');

    fluidParams_folder.add(guiControls, 'turbulentMix', 0.1, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'turbulentMix'), guiControls.turbulentMix);
      })
      .name('Turbulent Mix');

    fluidParams_folder.add(guiControls, 'jetStreamCoupling', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'jetStreamCoupling'), guiControls.jetStreamCoupling);
      })
      .name('Jet Stream Coupling');

    fluidParams_folder.add(guiControls, 'gravityWaveDrag', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'gravityWaveDrag'), guiControls.gravityWaveDrag);
      })
      .name('Gravity Wave Drag');

    fluidParams_folder.add(guiControls, 'mountainWaveStrength', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'mountainWaveStrength'), guiControls.mountainWaveStrength);
      })
      .name('Mountain Wave Strength');

    fluidParams_folder.add(guiControls, 'vortexStretching', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'vortexStretching'), guiControls.vortexStretching);
      })
      .name('Vortex Stretching');

    fluidParams_folder.add(guiControls, 'ageostrophicFlow', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'ageostrophicFlow'), guiControls.ageostrophicFlow);
      })
      .name('Ageostrophic Flow');

    fluidParams_folder.add(guiControls, 'moistBuoyancyBoost', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'moistBuoyancyBoost'), guiControls.moistBuoyancyBoost);
      })
      .name('Moist Buoyancy Boost');

    fluidParams_folder.add(guiControls, 'gravityCurrentStrength', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'gravityCurrentStrength'), guiControls.gravityCurrentStrength);
      })
      .name('Gravity Current Strength');
    fluidParams_folder.add(guiControls, 'shearProduction', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'shearProduction'), guiControls.shearProduction);
      })
      .name('Shear Production');

    fluidParams_folder.add(guiControls, 'tornadoPotential', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'tornadoPotential'), guiControls.tornadoPotential);
      })
      .name('Tornado Potential');

    fluidParams_folder.add(guiControls, 'frontogenesisStrength', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'frontogenesisStrength'), guiControls.frontogenesisStrength);
      })
      .name('Storm Front Strength');

    fluidParams_folder.add(guiControls, 'supercellHelicity', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'supercellHelicity'), guiControls.supercellHelicity);
      })
      .name('Supercell Helicity');

    fluidParams_folder.add(guiControls, 'mesocycloneFeedback', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'mesocycloneFeedback'), guiControls.mesocycloneFeedback);
      })
      .name('Mesocyclone Feedback');

    fluidParams_folder.add(guiControls, 'stormRelativeInflow', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'stormRelativeInflow'), guiControls.stormRelativeInflow);
      })
      .name('Storm Relative Inflow');

    fluidParams_folder.add(guiControls, 'occlusionDowndraftCoupling', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'occlusionDowndraftCoupling'), guiControls.occlusionDowndraftCoupling);
      })
      .name('Occlusion Coupling');

    fluidParams_folder.add(guiControls, 'gradientRichardsonMix', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'gradientRichardsonMix'), guiControls.gradientRichardsonMix);
      })
      .name('Richardson Stability Mix');

    fluidParams_folder.add(guiControls, 'turbulentPrandtl', 0.2, 2.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'turbulentPrandtl'), guiControls.turbulentPrandtl);
      })
      .name('Turbulent Prandtl');

    fluidParams_folder.add(guiControls, 'pblDepthMeters', 300.0, 5000.0, 10.0)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'pblDepthMeters'), guiControls.pblDepthMeters);
      })
      .name('PBL Depth (m)');

    fluidParams_folder.add(guiControls, 'entrainmentFluxBoost', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'entrainmentFluxBoost'), guiControls.entrainmentFluxBoost);
      })
      .name('Entrainment Flux Boost');

    fluidParams_folder.add(guiControls, 'terrainRuggednessBoost', 0.5, 2.0, 0.01).name('Terrain Ruggedness');
    fluidParams_folder.add(guiControls, 'terrainWetnessRecovery', 0.5, 2.0, 0.01).name('Terrain Wetness Recovery');
    fluidParams_folder.add(guiControls, 'terrainRiverBias', 0.3, 2.2, 0.01).name('Terrain River Bias');

    fluidParams_folder.add(guiControls, 'globalDrying', 0.0, 0.0001, 0.000001)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalDrying'), guiControls.globalDrying);
      })
      .name('Global Drying');

    fluidParams_folder.add(guiControls, 'globalHeating', -0.001, 0.001, 0.00001)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalHeating'), guiControls.globalHeating);
      })
      .name('Global Heating');

    // , 0, 1.0, 0.01
    fluidParams_folder.add(guiControls, 'soundingForcing', 0, 1.0, 0.01)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'soundingForcing'), guiControls.soundingForcing);
      })
      .name('Sounding Forcing');

    fluidParams_folder.add(guiControls, 'globalEffectsEndAlt', 0, guiControls.simHeight, 10)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        if (guiControls.globalEffectsEndAlt < guiControls.globalEffectsStartAlt) {
          guiControls.globalEffectsStartAlt = guiControls.globalEffectsEndAlt;
          gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsStartAlt'), guiControls.globalEffectsStartAlt / guiControls.simHeight);
        }
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsEndAlt'), guiControls.globalEffectsEndAlt / guiControls.simHeight);
      })
      .listen()
      .name('Apply below altitude');

    fluidParams_folder.add(guiControls, 'globalEffectsStartAlt', 0, guiControls.simHeight, 10)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        if (guiControls.globalEffectsStartAlt > guiControls.globalEffectsEndAlt) {
          guiControls.globalEffectsEndAlt = guiControls.globalEffectsStartAlt;
          gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsEndAlt'), guiControls.globalEffectsEndAlt / guiControls.simHeight);
        }

        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsStartAlt'), guiControls.globalEffectsStartAlt / guiControls.simHeight);
      })
      .listen()
      .name('Apply above altitude');


    var UI_folder = datGui.addFolder('Simulation Controls');

    function selectTool(toolId)
    {
      guiControls.tool = toolId;
    }

    const toolActions = {
      flashlight : () => selectTool('TOOL_NONE'),
      temperature : () => selectTool('TOOL_TEMPERATURE'),
      water : () => selectTool('TOOL_WATER'),
      smoke : () => selectTool('TOOL_SMOKE'),
      wind : () => selectTool('TOOL_WIND'),
      sand : () => selectTool('TOOL_SAND'),
      land : () => selectTool('TOOL_WALL_LAND'),
      sea : () => selectTool('TOOL_WALL_SEA'),
      urban : () => selectTool('TOOL_WALL_URBAN'),
      runway : () => selectTool('TOOL_WALL_RUNWAY'),
      industrial : () => selectTool('TOOL_WALL_INDUSTRIAL'),
      fire : () => selectTool('TOOL_WALL_FIRE'),
      skyscraper : () => selectTool('TOOL_SKYSCRAPER'),
      soilMoisture : () => selectTool('TOOL_WALL_MOIST'),
      snow : () => selectTool('TOOL_WALL_SNOW'),
      vegetation : () => selectTool('TOOL_VEGETATION'),
      lightningRod : () => selectTool('TOOL_LIGHTNING_ROD'),
      lightningGenerator : () => selectTool('TOOL_ARTIFICIAL_LIGHTNING'),
      weatherStation : () => selectTool('TOOL_STATION'),
      weatherBalloon : () => selectTool('TOOL_BALLOON')
    };

    UI_folder.add(guiControls, 'tool', {
      'Flashlight' : 'TOOL_NONE',
      'Temperature' : 'TOOL_TEMPERATURE',
      'Water Vapor / Cloud' : 'TOOL_WATER',
      'Land' : 'TOOL_WALL_LAND',
      'Lake / Sea' : 'TOOL_WALL_SEA',
      'Urban' : 'TOOL_WALL_URBAN',
      'Runway' : 'TOOL_WALL_RUNWAY',
      'Industrial' : 'TOOL_WALL_INDUSTRIAL',
      'Skyscraper' : 'TOOL_SKYSCRAPER',
      'Lightning Rod' : 'TOOL_LIGHTNING_ROD',
      'Artificial Lightning Generator' : 'TOOL_ARTIFICIAL_LIGHTNING',
      'Fire' : 'TOOL_WALL_FIRE',
      'Smoke / Dust' : 'TOOL_SMOKE',
      'Sand (SAN)' : 'TOOL_SAND',
      'Soil Moisture' : 'TOOL_WALL_MOIST',
      'Vegetation' : 'TOOL_VEGETATION',
      'Snow' : 'TOOL_WALL_SNOW',
      'Wind' : 'TOOL_WIND',
      'Weather Station' : 'TOOL_STATION',
      'Weather Balloon' : 'TOOL_BALLOON',
    }).name('Active Tool').listen();

    var quickTools_folder = UI_folder.addFolder('Quick Tool Buttons');
    quickTools_folder.add(toolActions, 'flashlight').name('Flashlight');
    quickTools_folder.add(toolActions, 'temperature').name('Temperature');
    quickTools_folder.add(toolActions, 'water').name('Water Vapor / Cloud');
    quickTools_folder.add(toolActions, 'wind').name('Wind');
    quickTools_folder.add(toolActions, 'smoke').name('Smoke / Dust');
    quickTools_folder.add(toolActions, 'land').name('Land');
    quickTools_folder.add(toolActions, 'sea').name('Lake / Sea');
    quickTools_folder.add(toolActions, 'urban').name('Urban');
    quickTools_folder.add(toolActions, 'runway').name('Runway');
    quickTools_folder.add(toolActions, 'industrial').name('Industrial');
    quickTools_folder.add(toolActions, 'fire').name('Fire');
    quickTools_folder.add(toolActions, 'skyscraper').name('Skyscraper');
    quickTools_folder.add(toolActions, 'soilMoisture').name('Soil Moisture');
    quickTools_folder.add(toolActions, 'snow').name('Snow');
    quickTools_folder.add(toolActions, 'vegetation').name('Vegetation');
    quickTools_folder.add(toolActions, 'lightningRod').name('Lightning Rod');
    quickTools_folder.add(toolActions, 'lightningGenerator').name('Artificial Lightning');
    quickTools_folder.add(toolActions, 'weatherStation').name('Weather Station');
    quickTools_folder.add(toolActions, 'weatherBalloon').name('Weather Balloon');

    UI_folder.add(guiControls, 'brushSize', 1, 2000, 1).name('Brush Diameter').listen();
    UI_folder.add(guiControls, 'wholeWidth').name('Whole Width Brush').listen();
    UI_folder.add(guiControls, 'brushIntensity', 0.005, 0.075, 0.001).name('Brush Intensity');
    UI_folder.add(guiControls, 'flashlightIntensity', 0.2, 3.0, 0.01).name('Flashlight Intensity').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'flashlightIntensity'), guiControls.flashlightIntensity);
    });
    UI_folder.add(guiControls, 'flashlightFocus', 0.4, 3.0, 0.01).name('Flashlight Focus').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'flashlightFocus'), guiControls.flashlightFocus);
    });
    UI_folder.add(guiControls, 'flashlightRange', 0.3, 2.5, 0.01).name('Flashlight Range').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'flashlightRange'), guiControls.flashlightRange);
    });
    UI_folder.add(guiControls, 'airplanePitchAuthority', 0.5, 2.2, 0.01).name('Airplane Pitch Authority');
    UI_folder.add(guiControls, 'airplaneThrottleResponse', 0.4, 2.0, 0.01).name('Airplane Throttle Response');
    UI_folder.add(guiControls, 'showTornadoLabels').name('Show Tornado Labels');
    UI_folder.add(guiControls, 'showLightningRods').name('Show Lightning Rods').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'showLightningRods'), guiControls.showLightningRods ? 1 : 0);
    });
    UI_folder.add(guiControls, 'allowEditingWhenPaused').name('Edit While Paused');
    UI_folder.add(guiControls, 'allowCaves')
      .onChange(function() {
        if (!gl)
          return;

        gl.useProgram(boundaryProgram);
        gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'allowCaves'), guiControls.allowCaves ? 1 : 0);
      })
      .name('Allow Caves');
    var radiation_folder = datGui.addFolder('Radiation');

    radiation_folder.add(guiControls, 'timeOfDay', 0.0, 23.96, 0.01).onChange(onUpdateTimeOfDaySlider).name('Time of day').listen();

    radiation_folder.add(guiControls, 'dayNightCycle').name('Day/Night Cycle').listen();

    radiation_folder.add(guiControls, 'accelerateNight').name('Accelerate Night').listen();

    radiation_folder.add(guiControls, 'latitude', -90.0, 90.0, 0.1).onChange(function() { updateSunlight(); }).name('Latitude').listen();

    radiation_folder.add(guiControls, 'month', 1.0, 12.99, 0.01).onChange(onUpdateMonthSlider).name('Month').listen();

    radiation_folder.add(guiControls, 'sunAngle', -10.0, 190.0, 0.1)
      .onChange(function() {
        updateSunlight('MANUAL_ANGLE');
        guiControls.dayNightCycle = false;
      })
      .name('Sun Angle')
      .listen();

    radiation_folder.add(guiControls, 'sunIntensity', 0.0, 2.0, 0.01).onChange(function() { updateSunlight('MANUAL_ANGLE'); }).name('Sun Intensity');
    radiation_folder.add(guiControls, 'diurnalThermalLag', 0.2, 3.0, 0.01).onChange(function() { updateSunlight('MANUAL_ANGLE'); }).name('Diurnal Thermal Lag');

    radiation_folder.add(guiControls, 'greenhouseGases', 0.0, 0.01, 0.0001)
      .onChange(function() {
        gl.useProgram(lightingProgram);
        gl.uniform1f(gl.getUniformLocation(lightingProgram, 'greenhouseGases'), guiControls.greenhouseGases);
      })
      .name('Greenhouse Gases');

    radiation_folder.add(guiControls, 'waterGreenHouseEffect', 0.0, 0.01, 0.0001)
      .onChange(function() {
        gl.useProgram(lightingProgram);
        gl.uniform1f(gl.getUniformLocation(lightingProgram, 'waterGreenHouseEffect'), guiControls.waterGreenHouseEffect);
      })
      .name('Water Vapor Greenhouse Effect');

    radiation_folder
      .add(guiControls, 'IR_rate', 0.0, 10.0, 0.1)
      /*.onChange(function() {
        gl.useProgram(lightingProgram);
        gl.uniform1f(gl.getUniformLocation(lightingProgram, 'IR_rate'), guiControls.IR_rate);
      })*/
      .name('IR Multiplier');
    radiation_folder.add(guiControls, 'radiationHaze', 0.2, 2.5, 0.01).name('Radiation Haze').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'radiationHaze'), guiControls.radiationHaze);
    });

    var water_folder = datGui.addFolder('Water');

    water_folder.add(guiControls, 'waterTemperature', 0.0, 40.0, 0.1)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'waterTemperature'), CtoK(guiControls.waterTemperature));
        gl.useProgram(lightingProgram);
        gl.uniform1f(gl.getUniformLocation(lightingProgram, 'waterTemperature'), CtoK(guiControls.waterTemperature));
      })
      .name('Lake / Sea Temperature (°C)');

    water_folder.add(guiControls, 'dynamicWaterTemperature').name('Dynamic Water Temperature').onChange(function() {
      if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
      gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'dynamicWaterTemperature'), guiControls.dynamicWaterTemperature ? 1.0 : 0.0);
    });

    water_folder.add(guiControls, 'landEvaporation', 0.0, 0.0002, 0.00001)
      .onChange(function() {
        if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'landEvaporation'), guiControls.landEvaporation);
      })
      .name('Land Evaporation');
    water_folder.add(guiControls, 'waterEvaporation', 0.0, 0.0004, 0.00001)
      .onChange(function() {
        if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterEvaporation'), guiControls.waterEvaporation);
      })
      .name('Lake / Sea Evaporation');
    water_folder.add(guiControls, 'evapHeat', 0.0, 5.0, 0.1)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'evapHeat'), guiControls.evapHeat);
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'evapHeat'), guiControls.evapHeat);
        if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'evapHeat'), guiControls.evapHeat);
      })
      .name('Evaporation Heat');
    water_folder.add(guiControls, 'meltingHeat', 0.0, 5.0, 0.1)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'meltingHeat'), guiControls.meltingHeat);
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'meltingHeat'), guiControls.meltingHeat);
      })
      .name('Melting Heat');
    water_folder.add(guiControls, 'condensationRate', 0.001, 0.020, 0.001)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'condensationRate'), guiControls.condensationRate);
      })
      .listen()
      .name('Condensation Rate');
    water_folder.add(guiControls, 'waterWeight', 0.0, 2.0, 0.01)
      .onChange(function() {
        if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterWeight'), guiControls.waterWeight);
      })
      .name('Water Weight');

    water_folder.add(guiControls, 'precipitationRecycling', 0.2, 2.0, 0.01)
      .onChange(function() {
        if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'precipitationRecycling'), guiControls.precipitationRecycling);
      })
      .name('Precip Recycling');

    water_folder.add(guiControls, 'surfaceRunoffRate', 0.2, 3.0, 0.01)
      .onChange(function() {
        if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'surfaceRunoffRate'), guiControls.surfaceRunoffRate);
      })
      .name('Surface Runoff');

    water_folder.add(guiControls, 'soilInfiltrationRate', 0.2, 3.0, 0.01)
      .onChange(function() {
        if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'soilInfiltrationRate'), guiControls.soilInfiltrationRate);
      })
      .name('Soil Infiltration');

    water_folder.add(guiControls, 'canopyInterception', 0.0, 2.0, 0.01)
      .onChange(function() {
        if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'canopyInterception'), guiControls.canopyInterception);
      })
      .name('Canopy Interception');

    water_folder.add(guiControls, 'urbanHeatIslandStrength', 0.0, 3.0, 0.01)
      .onChange(function() {
        if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'urbanHeatIslandStrength'), guiControls.urbanHeatIslandStrength);
      })
      .name('Urban Heat Island');

    water_folder.add(guiControls, 'coastalMixing', 0.2, 2.5, 0.01)
      .onChange(function() {
        if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'coastalMixing'), guiControls.coastalMixing);
      })
      .name('Coastal Mixing');

    water_folder.add(guiControls, 'waterAlbedoShift', -0.5, 0.5, 0.01)
      .onChange(function() {
        if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterAlbedoShift'), guiControls.waterAlbedoShift);
      })
      .name('Water Albedo Shift');

    var precipitation_folder = datGui.addFolder('Precipitation');

    precipitation_folder.add(guiControls, 'aboveZeroThreshold', 0.1, 2.0, 0.001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'aboveZeroThreshold'), guiControls.aboveZeroThreshold);
      })
      .name('Precipitation Threshold +°C');

    precipitation_folder.add(guiControls, 'subZeroThreshold', 0.0, 1.0, 0.001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'subZeroThreshold'), guiControls.subZeroThreshold);
      })
      .name('Precipitation Threshold -°C');

    precipitation_folder.add(guiControls, 'spawnChance', 0.00001, 0.0001, 0.00001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'spawnChanceMult'), guiControls.spawnChance);
      })
      .name('Spawn Rate')
      .listen();

    precipitation_folder.add(guiControls, 'mobilePrecipBoost', 0.5, 2.5, 0.01)
      .onChange(function() {
        const mobileLightningVisibility = getMobileLightningVisibility();
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'mobilePrecipBoost'), guiControls.mobilePrecipBoost);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'mobileLightningVisibility'), getMobileLightningVisibility());
        gl.useProgram(realisticDisplayProgram);
        gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'mobileLightningVisibility'), getMobileLightningVisibility());
    gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'showLightningRods'), guiControls.showLightningRods ? 1 : 0);
      })
      .name('Mobile Precip Boost');
      

    precipitation_folder.add(guiControls, 'stormMoistureLift', 0.6, 2.5, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'stormMoistureLift'), guiControls.stormMoistureLift);
      })
      .name('Storm Moisture Lift');

    precipitation_folder.add(guiControls, 'lightningFrequencyBoost', 0.4, 4.0, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningFrequencyBoost'), guiControls.lightningFrequencyBoost);
      })
      .name('Lightning Frequency Boost');

    precipitation_folder.add(guiControls, 'dryLightningAllowance', 0.0, 1.0, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'dryLightningAllowance'), guiControls.dryLightningAllowance);
      })
      .name('Dry Lightning Allowance');

    precipitation_folder.add(guiControls, 'stormPulseStrength', 0.0, 2.0, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'stormPulseStrength'), guiControls.stormPulseStrength);
      })
      .name('Storm Pulse Strength');

    precipitation_folder.add(guiControls, 'lightningRecoveryBoost', 0.4, 2.0, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningRecoveryBoost'), guiControls.lightningRecoveryBoost);
      })
      .name('Lightning Recovery Boost');

    precipitation_folder.add(guiControls, 'lightningChanceMult', 0, 10, 0.1)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningChanceMult'), guiControls.lightningChanceMult);
      })
      .name('Lightning Chance Multiplier');
    
    precipitation_folder.add(guiControls, 'lightningMinInterval', 0, 60, 1)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningMinInterval'), guiControls.lightningMinInterval);
      })
      .name('Min iteration of lightning');

    precipitation_folder.add(guiControls, 'icLightningRatio', 0.0, 1.0, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'icLightningRatio'), guiControls.icLightningRatio);
      })
      .name('IC Lightning Ratio');

    precipitation_folder.add(guiControls, 'ctgLightningRatio', 0.0, 1.0, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'ctgLightningRatio'), guiControls.ctgLightningRatio);
      })
      .name('CG Lightning Ratio');

    precipitation_folder.add(guiControls, 'lightningFlashRate', 0.3, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningFlashRate'), guiControls.lightningFlashRate);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningComplexity'), guiControls.lightningComplexity);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'multiStrokeLightning'), guiControls.multiStrokeLightning);
      })
      .name('Flash Rate');

    precipitation_folder.add(guiControls, 'precipitationEffectMult', 0.4, 2.0, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'precipitationEffectMult'), guiControls.precipitationEffectMult);
      })
      .name('Precip Effect Mult');

    precipitation_folder.add(guiControls, 'lightningGroundBias', 0.0, 2.0, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningGroundBias'), guiControls.lightningGroundBias);
      })
      .name('Ground Strike Bias');

    precipitation_folder.add(guiControls, 'stormOrganization', 0.2, 2.5, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'stormOrganization'), guiControls.stormOrganization);
      })
      .name('Storm Organization');

    precipitation_folder.add(guiControls, 'aerosolLoad', 0.2, 2.5, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'aerosolLoad'), guiControls.aerosolLoad);
      })
      .name('Aerosol Load');

    precipitation_folder.add(guiControls, 'entrainmentRate', 0.2, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'entrainmentRate'), guiControls.entrainmentRate);
      })
      .name('Entrainment Rate');

    precipitation_folder.add(guiControls, 'downdraftCoolingMult', 0.2, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'downdraftCoolingMult'), guiControls.downdraftCoolingMult);
      })
      .name('Downdraft Cooling');

    precipitation_folder.add(guiControls, 'microburstStrength', 0.0, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'microburstStrength'), guiControls.microburstStrength);
      })
      .name('Microburst Strength');

    precipitation_folder.add(guiControls, 'lightningBranching', 0.2, 3.0, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningBranching'), guiControls.lightningBranching);
      })
      .name('Lightning Branching');

    precipitation_folder.add(guiControls, 'lightningAnvilDrift', 0.0, 2.0, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningAnvilDrift'), guiControls.lightningAnvilDrift);
      })
      .name('Lightning Anvil Drift');

    precipitation_folder.add(guiControls, 'precipitationSizeSpectrum', 0.2, 2.5, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'precipitationSizeSpectrum'), guiControls.precipitationSizeSpectrum);
      })
      .name('Size Spectrum');

    precipitation_folder.add(guiControls, 'hailShatterFactor', 0.0, 2.5, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'hailShatterFactor'), guiControls.hailShatterFactor);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'mobilePrecipBoost'), guiControls.mobilePrecipBoost);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'mobileLightningVisibility'), getMobileLightningVisibility());
      })
      .name('Hail Shatter');
      
    precipitation_folder.add(guiControls, 'snowDensity', 0.1, 0.9, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'snowDensity'), guiControls.snowDensity);
      })
      .name('Snow Density');

    precipitation_folder.add(guiControls, 'fallSpeed', 0.0001, 0.001, 0.0001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'fallSpeed'), guiControls.fallSpeed);
      })
      .name('Fall Speed');

    precipitation_folder.add(guiControls, 'growthRate0C', 0.0001, 0.005, 0.0001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'growthRate0C'), guiControls.growthRate0C);
      })
      .name('Growth Rate 0°C');

    precipitation_folder.add(guiControls, 'growthRate_30C', 0.0001, 0.005, 0.0001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'growthRate_30C'), guiControls.growthRate_30C);
      })
      .name('Growth Rate -30°C');

    precipitation_folder
      .add(guiControls, 'freezingRate', 0.0005, 0.01, 0.0001) // 0.0035
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'freezingRate'), guiControls.freezingRate);
      })
      .name('Freezing Rate');

    precipitation_folder
      .add(guiControls, 'meltingRate', 0.0005, 0.01, 0.0001) // 0.0035
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'meltingRate'), guiControls.meltingRate);
      })
      .name('Melting Rate');
    precipitation_folder.add(guiControls, 'evapRate', 0.0001, 0.005, 0.0001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'evapRate'), getAdaptiveEvapRate());
      })
      .name('Evaporation Rate');
    precipitation_folder.add(guiControls, 'cloudLifetimeBoost', 0.5, 2.5, 0.01).name('Cloud Lifetime Boost').onChange(function() {
      if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
      gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'cloudLifetimeBoost'), guiControls.cloudLifetimeBoost);
    });
    precipitation_folder.add(guiControls, 'entrainmentDilution', 0.4, 2.5, 0.01).name('Entrainment Dilution').onChange(function() {
      gl.useProgram(precipitationProgram);
      gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'entrainmentDilution'), guiControls.entrainmentDilution);
    });
    precipitation_folder.add(guiControls, 'kesslerAutoconversion', 0.3, 2.5, 0.01).name('Kessler Autoconversion').onChange(function() {
      gl.useProgram(precipitationProgram);
      gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'kesslerAutoconversion'), guiControls.kesslerAutoconversion);
    });
    precipitation_folder.add(guiControls, 'ventilationEvapEnhancement', 0.3, 2.5, 0.01).name('Ventilation Evap').onChange(function() {
      gl.useProgram(precipitationProgram);
      gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'ventilationEvapEnhancement'), guiControls.ventilationEvapEnhancement);
    });
    precipitation_folder.add(guiControls, 'drizzleThresholdShift', 0.6, 1.6, 0.01).name('Drizzle Threshold Shift').onChange(function() {
      gl.useProgram(precipitationProgram);
      gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'drizzleThresholdShift'), guiControls.drizzleThresholdShift);
    });
    precipitation_folder.add(guiControls, 'graupelChargeGain', 0.2, 2.5, 0.01).name('Graupel Charge Gain').onChange(function() {
      gl.useProgram(precipitationProgram);
      gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'graupelChargeGain'), guiControls.graupelChargeGain);
    });
    precipitation_folder.add(guiControls, 'iceCrystalChargeGain', 0.2, 2.5, 0.01).name('Ice Crystal Charge Gain').onChange(function() {
      gl.useProgram(precipitationProgram);
      gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'iceCrystalChargeGain'), guiControls.iceCrystalChargeGain);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'stormMoistureLift'), guiControls.stormMoistureLift);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningFrequencyBoost'), guiControls.lightningFrequencyBoost);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'dryLightningAllowance'), guiControls.dryLightningAllowance);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'stormPulseStrength'), guiControls.stormPulseStrength);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningRecoveryBoost'), guiControls.lightningRecoveryBoost);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'airplaneLightningAttractor'), guiControls.airplaneLightningAttractor);
    });

    precipitation_folder.add(guiControls, 'inactiveDroplets', 0, NUM_DROPLETS).listen().name('Inactive Droplets');

    var lightning_folder = datGui.addFolder('Lightning & Shake');

    lightning_folder.add(guiControls, 'cameraShake').name('Camera Shake');
    lightning_folder.add(guiControls, 'shakeFrequency', 0.5, 3.0, 0.01).name('Shake Frequency');
    lightning_folder.add(guiControls, 'shakeDecay', 0.60, 0.92, 0.005).name('Shake Decay');
    lightning_folder.add(guiControls, 'lightningMotionBlur', 0.0, 1.0, 0.01).name('Shake Motion Blur');
    lightning_folder.add(guiControls, 'lightningTempShakeMult', 0.5, 2.5, 0.01).name('Temp -> Shake Mult');
    lightning_folder.add(guiControls, 'lightningComplexity', 0.4, 2.6, 0.01).name('Lightning Complexity').onChange(function() {
      gl.useProgram(precipitationProgram);
      gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningComplexity'), guiControls.lightningComplexity);
    });
    lightning_folder.add(guiControls, 'multiStrokeLightning', 0.0, 2.0, 0.01).name('Multi-Stroke').onChange(function() {
      gl.useProgram(precipitationProgram);
      gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'multiStrokeLightning'), guiControls.multiStrokeLightning);
    });
    lightning_folder.add(guiControls, 'lightningColorTempMult', 0.0, 2.0, 0.01).name('Temp -> Bolt Color').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningColorTempMult'), guiControls.lightningColorTempMult);
    });
    lightning_folder.add(guiControls, 'lightningFlashPersistence', 0.5, 2.5, 0.01).name('Flash Persistence').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningFlashPersistence'), guiControls.lightningFlashPersistence);
    });
    lightning_folder.add(guiControls, 'lightningTempMinK', 5000, 18000, 100).name('Min Temp (K)').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningTempMinK'), guiControls.lightningTempMinK);
    });
    lightning_folder.add(guiControls, 'lightningTempMaxK', 20000, 50000, 100).name('Max Temp (K)').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningTempMaxK'), guiControls.lightningTempMaxK);
    });
    lightning_folder.add(guiControls, 'electricFieldVizStrength', 0.0, 3.0, 0.01).name('Electric Field Viz').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'electricFieldVizStrength'), guiControls.electricFieldVizStrength);
    });
    lightning_folder.add(guiControls, 'dynamicChargeSeparation', 0.0, 3.0, 0.01).name('Charge Separation').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'dynamicChargeSeparation'), guiControls.dynamicChargeSeparation);
    });
    lightning_folder.add(guiControls, 'electricFieldDiffusion', 0.0, 3.0, 0.01).name('Field Diffusion').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'electricFieldDiffusion'), guiControls.electricFieldDiffusion);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'mobileLightningVisibility'), getMobileLightningVisibility());
    gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'showLightningRods'), guiControls.showLightningRods ? 1 : 0);
    });
    lightning_folder.add(guiControls, 'lightningRodRadiusKm', 1.0, 40.0, 0.5).name('Lightning Rod Radius (km)');
    lightning_folder.add(guiControls, 'airplaneLightningAttractor', 0.0, 2.0, 0.01).name('Airplane Lightning Attractor');

    var balloon_folder = datGui.addFolder('Weather Balloons');
    balloon_folder.add(guiControls, 'balloonRiseRate', 0.05, 0.60, 0.01).name('Rise Rate');
    balloon_folder.add(guiControls, 'balloonDriftMult', 0.2, 2.0, 0.01).name('Drift Multiplier');
    balloon_folder.add(guiControls, 'balloonBurstPressure', 120.0, 500.0, 1.0).name('Burst Pressure hPa');
    balloon_folder.add(guiControls, 'balloonTelemetryDetailed').name('Detailed Telemetry');


    var graphics_folder = datGui.addFolder('Graphics Settings');
    var graphicsQuality_folder = graphics_folder.addFolder('Quality');
    var graphicsDevice_folder = graphics_folder.addFolder('Device Info');

    graphicsQuality_folder.add(guiControls, 'graphicsPreset', ['Low', 'Medium', 'High', 'Ultra']).name('Preset').onChange(function() {
      applyGraphicsPresetSettings(guiControls.graphicsPreset);
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningBloomStrength'), guiControls.lightningBloomStrength);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'precipitationVisualBoost'), guiControls.precipitationVisualBoost);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'precipitationTint'), guiControls.precipitationTint);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'precipitationContrast'), guiControls.precipitationContrast);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'ambientScattering'), guiControls.ambientScattering);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'cloudLayerComplexity'), guiControls.cloudLayerComplexity);
      resizeCanvasAndPostFx();
    });
    graphicsQuality_folder.add(guiControls, 'renderScale', 0.5, 1.5, 0.01).name('Render Scale').onChange(function() {
      resizeCanvasAndPostFx();
    });
    graphicsQuality_folder.add(guiControls, 'pixelRatioScale', 0.5, 1.5, 0.01).name('Pixel Ratio Scale').onChange(function() {
      resizeCanvasAndPostFx();
    });
    graphicsQuality_folder.add(guiControls, 'simulationProfile', ['Calm', 'Balanced', 'Dynamic', 'Extreme']).name('Simulation Profile').onChange(function() {
      applySimulationProfile(guiControls.simulationProfile);
    });

    runtimeDeviceInfo = {
      summary : getDeviceInfoSummary(),
      resolution : `${window.innerWidth} x ${window.innerHeight}`,
      userAgent : navigator.userAgent
    };
    graphicsDevice_folder.add(runtimeDeviceInfo, 'summary').name('Summary').listen();
    graphicsDevice_folder.add(runtimeDeviceInfo, 'resolution').name('Viewport').listen();
    graphicsDevice_folder.add(runtimeDeviceInfo, 'userAgent').name('User Agent').listen();
    var display_folder = datGui.addFolder('Display');

    display_folder.add(guiControls, 'cloudLayerComplexity', 0.5, 2.5, 0.01).name('Cloud Layer Complexity').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'cloudLayerComplexity'), guiControls.cloudLayerComplexity);
    });

    display_folder
      .add(guiControls, 'displayMode', {
        '1 Temperature -26°C to 30°C' : 'DISP_TEMPERATURE',
        '2 Water Vapor' : 'DISP_WATER',
        '3 Realistic' : 'DISP_REAL',
        '4 Horizontal Velocity' : 'DISP_HORIVEL',
        '5 Vertical Velocity' : 'DISP_VERTVEL',
        '6 IR Heating / Cooling' : 'DISP_IRHEATING',
        '7 IR Down -60°C to 26°C' : 'DISP_IRDOWNTEMP',
        '8 IR Up -26°C to 30°C' : 'DISP_IRUPTEMP',
        '9 Precipitation Mass' : 'DISP_PRECIPFEEDBACK_MASS',
        'Precipitation Heating/Cooling' : 'DISP_PRECIPFEEDBACK_HEAT',
        'Precipitation Condensation/Evaporation' : 'DISP_PRECIPFEEDBACK_VAPOR',
        'Rain Deposition' : 'DISP_PRECIPFEEDBACK_RAIN',
        'Snow Deposition' : 'DISP_PRECIPFEEDBACK_SNOW',
        'Precipitation/Soil Moisture' : 'DISP_SOIL_MOISTURE',
        'Curl' : 'DISP_CURL',
        'Air Quality' : 'DISP_AIRQUALITY',
        'Radar Reflectivity' : 'DISP_RADAR'
      })
      .name('Display Mode')
      .onChange(function() { guiControls.displayMode = sanitizeDisplayMode(guiControls.displayMode); })
      .listen();
    display_folder.add(guiControls, 'exposure', 0.5, 5.0, 0.01)
      .onChange(function() {
        gl.useProgram(postProcessingProgram);
        gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), guiControls.exposure);
      })
      .name('Exposure');
    display_folder.add(guiControls, 'precipitationVisualBoost', 0.5, 2.0, 0.01).name('Precip Lighting Boost').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'precipitationVisualBoost'), guiControls.precipitationVisualBoost);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'precipitationTint'), guiControls.precipitationTint);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'precipitationContrast'), guiControls.precipitationContrast);
    });
    display_folder.add(guiControls, 'precipitationTint', 0.4, 1.8, 0.01).name('Precipitation Tint').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'precipitationTint'), guiControls.precipitationTint);
    });
    display_folder.add(guiControls, 'precipitationContrast', 0.6, 1.6, 0.01).name('Precipitation Contrast').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'precipitationContrast'), guiControls.precipitationContrast);
    });
    display_folder.add(guiControls, 'ambientScattering', 0.3, 2.5, 0.01).name('Ambient Scattering').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'ambientScattering'), guiControls.ambientScattering);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'cloudLayerComplexity'), guiControls.cloudLayerComplexity);
    });
    display_folder.add(guiControls, 'lightningBloomStrength', 0.2, 2.5, 0.01).name('Lightning Bloom').onChange(function() {
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningBloomStrength'), guiControls.lightningBloomStrength);
    });

    display_folder.add(guiControls, 'camSpeed', 0.001, 0.050, 0.001).name('Camera Pan Speed');


    display_folder.add(guiControls, 'wrapHorizontally')
      .onChange(function() {
        cam.wrapHorizontally = guiControls.wrapHorizontally;
        cam.center();
        if (guiControls.wrapHorizontally)
          horizontalDisplayMult = 3.0;
        else
          horizontalDisplayMult = 1.0;
      })
      .name('Wrap Horizontally');

    display_folder.add(guiControls, 'SmoothCam').onChange(function() { cam.smooth = guiControls.SmoothCam; }).name('Smooth Camera');

    display_folder.add(guiControls, 'showGraph').onChange(hideOrShowGraph).name('Show Sounding Graph').listen();
    display_folder.add(guiControls, 'showDrops').name('Show Droplets').listen();
    display_folder.add(guiControls, 'showFPS').name('Show FPS Counter');
    display_folder.add(guiControls, 'showWeatherBalloons').name('Show Weather Balloons');
    display_folder.add(guiControls, 'realDewPoint').name('Show Real Dew Point');


    display_folder.add(guiControls, 'twelveHourClock').name('12-hour clock');

    display_folder
      .add(guiControls, 'lengthUnit', {
        'km / meters / cm / mm' : 'LENGTH_UNIT_METRIC',
        'miles / ft / inch' : 'LENGTH_UNIT_IMPERIAL',
      })
      .name('Length Unit')
      .onChange(function() {
        for (i = 0; i < weatherStations.length; i++) {
          weatherStations[i].clearChart();
        }
      });

    display_folder
      .add(guiControls, 'speedUnit', {
        'km/h' : 'SPEED_UNIT_KMH',
        'm/s' : 'SPEED_UNIT_MS',
        'mph' : 'SPEED_UNIT_MPH',
        'kt' : 'SPEED_UNIT_KT',
      })
      .name('Speed Unit')
      .onChange(function() {
        for (i = 0; i < weatherStations.length; i++) {
          weatherStations[i].clearChart();
        }
      });

    display_folder
      .add(guiControls, 'tempUnit', {
        '°C' : 'TEMP_UNIT_C',
        '°F' : 'TEMP_UNIT_F',
        'K' : 'TEMP_UNIT_K',
      })
      .name('Temperature Unit')
      .onChange(function() {
        for (i = 0; i < weatherStations.length; i++) {
          weatherStations[i].clearChart();
        }
      });


    var advanced_folder = datGui.addFolder('Advanced');

    advanced_folder.add(guiControls, 'enablePrecipitation')
      .onChange(function() {
        initRainDrops();
        setupPrecipitationBuffers();
        guiControls.inactiveDroplets = NUM_DROPLETS;
      })
      .name('Enable Precipitation');

    advanced_folder.add(guiControls, 'IterPerFrame', 1, 50, 1).onChange(function() { guiControls.auto_IterPerFrame = false; }).name('Iterations / Frame').listen();

    advanced_folder.add(guiControls, 'auto_IterPerFrame').name('Auto Adjust').listen();


    advanced_folder.add(guiControls, 'sound').name('Enable Sound').onChange(function() {
      if (guiControls.sound) {
        if (soundSystem == null) {
          soundSystem = new SoundSystem();
        }
      } else if (soundSystem) {
        soundSystem.mute();
      }
    });

    advanced_folder.add(guiControls, 'resetSettings').name('Reset all settings');

    datGui.add(guiControls, 'paused').onChange(handlePause).name('Paused').listen();
    datGui.add(guiControls, 'recreateSimulation').name('Recreate Simulation');
    datGui.add(guiControls, 'download').name('Save Simulation to File');

    // keep core controls visible when simulation starts
    fluidParams_folder.open();
    precipitation_folder.open();
    lightning_folder.open();
    display_folder.open();

    datGui.width = 400;
  }

  // guiControls.paused = true; // pause before first iteration for debugging

  await loadingBar.set(3, 'Initializing Sounding Graph');
  // END OF GUI


  function ensureMobileFlightControls()
  {
    const isMobile = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
    if (!isMobile)
      return;
    if (!mobileFlightUi) {
      mobileFlightUi = document.createElement('div');
      mobileFlightUi.id = 'mobileFlightControls';
      mobileFlightUi.style.position = 'absolute';
      mobileFlightUi.style.right = '12px';
      mobileFlightUi.style.bottom = '12px';
      mobileFlightUi.style.zIndex = '40';
      mobileFlightUi.style.display = 'none';
      mobileFlightUi.style.gap = '8px';
      mobileFlightUi.style.flexDirection = 'column';
      mobileFlightUi.style.pointerEvents = 'auto';
      mobileFlightUi.style.userSelect = 'none';
      const mkBtn=(txt,onDown,onUp)=>{
        const b=document.createElement('button');
        b.textContent=txt;
        b.style.padding='10px 12px';
        b.style.background='rgba(10,16,32,0.78)';
        b.style.color='#d8ecff';
        b.style.border='1px solid #4d6b93';
        b.style.borderRadius='8px';
        b.addEventListener('touchstart',e=>{e.preventDefault();onDown();},{passive:false});
        b.addEventListener('touchend',e=>{e.preventDefault();onUp();},{passive:false});
        return b;
      };
      mobileFlightUi.appendChild(mkBtn('Elevator +', ()=>{zPressed = 1;}, ()=>{zPressed = 0;}));
      mobileFlightUi.appendChild(mkBtn('Elevator -', ()=>{zPressed = -1;}, ()=>{zPressed = 0;}));
      mobileFlightUi.appendChild(mkBtn('Throttle +', ()=>{airplane.throttle = clamp(airplane.throttle + 0.06,0,1);}, ()=>{}));
      mobileFlightUi.appendChild(mkBtn('Throttle -', ()=>{airplane.throttle = clamp(airplane.throttle - 0.06,0,1);}, ()=>{}));
      document.body.appendChild(mobileFlightUi);
    }
    mobileFlightUi.style.display = airplaneMode ? 'flex' : 'none';
  }

  function startSimulation()
  {
    SETUP_MODE = false;

    pendingLightningShakeEvents.length = 0;
    lightningShakeOffsetX = lightningShakeOffsetY = 0.0;
    lightningShakeVelocityX = lightningShakeVelocityY = 0.0;
    lightningShakeHFOffsetX = lightningShakeHFOffsetY = 0.0;
    lightningShakeHFAmplitude = 0.0;
    lightningShakePhaseX = lightningShakePhaseY = 0.0;
    gl.useProgram(realisticDisplayProgram);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningColorTempMult'), guiControls.lightningColorTempMult);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'electricFieldVizStrength'), guiControls.electricFieldVizStrength);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'dynamicChargeSeparation'), guiControls.dynamicChargeSeparation);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'electricFieldDiffusion'), guiControls.electricFieldDiffusion);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'mobileLightningVisibility'), getMobileLightningVisibility());
    gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'showLightningRods'), guiControls.showLightningRods ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningFlashPersistence'), guiControls.lightningFlashPersistence);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningTempMinK'), guiControls.lightningTempMinK);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningTempMaxK'), guiControls.lightningTempMaxK);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'precipitationVisualBoost'), guiControls.precipitationVisualBoost);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'precipitationTint'), guiControls.precipitationTint);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'precipitationContrast'), guiControls.precipitationContrast);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'ambientScattering'), guiControls.ambientScattering);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'cloudLayerComplexity'), guiControls.cloudLayerComplexity);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningBloomStrength'), guiControls.lightningBloomStrength);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'flashlightIntensity'), guiControls.flashlightIntensity);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'flashlightFocus'), guiControls.flashlightFocus);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'flashlightRange'), guiControls.flashlightRange);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'radiationHaze'), guiControls.radiationHaze);
    gl.useProgram(postProcessingProgram);
    gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), guiControls.exposure);
    datGui.show(); // unhide

    clockEl = document.createElement('div');
    document.body.appendChild(clockEl);

    clockEl.innerHTML = ''
    clockEl.style.position = 'absolute';
    clockEl.style.fontFamily = 'Monospace';
    clockEl.style.fontSize = '35px';
    clockEl.style.color = 'white';

    simDateTime = new Date(2000, Math.floor(guiControls.month) - 1, (guiControls.month % 1) * 30.417);

    if (!fpsCounterEl) {
      fpsCounterEl = document.createElement('div');
      document.body.appendChild(fpsCounterEl);
      fpsCounterEl.style.position = 'fixed';
      fpsCounterEl.style.right = '14px';
      fpsCounterEl.style.top = '14px';
      fpsCounterEl.style.zIndex = '3';
      fpsCounterEl.style.padding = '8px 12px';
      fpsCounterEl.style.background = 'linear-gradient(180deg, rgba(8,20,46,0.75), rgba(4,10,26,0.75))';
      fpsCounterEl.style.border = '1px solid rgba(119,218,255,0.45)';
      fpsCounterEl.style.borderRadius = '10px';
      fpsCounterEl.style.fontFamily = 'Monospace';
      fpsCounterEl.style.fontSize = '12px';
      fpsCounterEl.style.color = '#d8f6ff';
      fpsCounterEl.style.minWidth = '136px';
      fpsCounterEl.style.textAlign = 'right';
      fpsCounterEl.style.whiteSpace = 'pre-line';
    }

    // initialize time and solar angle
    if (guiControls.dayNightCycle) {
      onUpdateTimeOfDaySlider();
      onUpdateMonthSlider();
    } else {
      updateSunlight('MANUAL_ANGLE'); // set angle from savefile
    }
  }

  var soundingGraph = {
    graphCanvas : null,
    ctx : null,
    init : function() {
      this.graphCanvas = getEl('graphCanvas');
      if (!this.graphCanvas)
        return;
      this.graphCanvas.height = window.innerHeight;
      this.graphCanvas.width = this.graphCanvas.height;
      this.ctx = this.graphCanvas.getContext('2d');
      var style = this.graphCanvas.style;
      if (guiControls.showGraph)
        style.display = 'block';
      else
        style.display = 'none';
    },
    draw : function(simXpos, simYpos) {
      // draw graph
      // mouse positions in sim coordinates
      if (!this.graphCanvas || !this.ctx)
        return;
      const graphCanvas = this.graphCanvas;

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      var baseTextureValues = new Float32Array(4 * sim_res_y);
      gl.readPixels(simXpos, 0, 1, sim_res_y, gl.RGBA, gl.FLOAT,
                    baseTextureValues); // read a vertical culumn of cells

      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      var waterTextureValues = new Float32Array(4 * sim_res_y);
      gl.readPixels(simXpos, 0, 1, sim_res_y, gl.RGBA, gl.FLOAT, waterTextureValues); // read a vertical culumn of cells

      gl.readBuffer(gl.COLOR_ATTACHMENT2);
      var wallTextureValues = new Int32Array(4 * sim_res_y);
      gl.readPixels(simXpos, 0, 1, sim_res_y, gl.RGBA_INTEGER, gl.INT, wallTextureValues); // read a vertical column of cells


      const graphBottem = this.graphCanvas.height - 40; // in pixels

      var c = this.ctx;

      c.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
      c.fillStyle = '#00000055';
      c.fillRect(0, 0, graphCanvas.width, graphCanvas.height);

      drawIsotherms();

      var reachedAir = false;
      var surfaceLevel;

      // Draw temperature line
      c.beginPath();
      for (var y = 0; y < sim_res_y; y++) {
        var potentialTemp = baseTextureValues[4 * y + 3];

        var temp = potentialTemp - ((y / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0 - 273.15;

        var scrYpos = map_range(y, sim_res_y, 0, 0, graphBottem);

        c.font = '15px Arial';
        c.fillStyle = 'white';

        if (wallTextureValues[4 * y + 1] != 0) { // if this is fluid cell
          if (!reachedAir) {
            // first non wall cell
            reachedAir = true;
            surfaceLevel = y;

            if (simYpos < surfaceLevel)
              simYpos = surfaceLevel;
          }
          if (reachedAir && y == simYpos) {
            // c.fillText('' + Math.round(map_range(y-1, 0, sim_res_y, 0,
            // guiControls.simHeight)) + ' m', 5, scrYpos + 5);
            c.strokeStyle = '#FFF';
            c.lineWidth = 1.0;
            c.strokeRect(T_to_Xpos(temp, scrYpos), scrYpos, 10,
                         1); // vertical position indicator
            c.fillText('' + printTemp(temp), T_to_Xpos(temp, scrYpos) + 20, scrYpos + 5);
          }

          c.lineTo(T_to_Xpos(temp, scrYpos), scrYpos);  // temperature
        } else if (wallTextureValues[4 * y + 2] == 0) { // is surface layer
          if (wallTextureValues[4 * y + 0] != 2) {      // is land, urban or fire
            c.fillStyle = 'white';
            c.lineWidth = 1.0;

            let soilMoisture_mm = waterTextureValues[4 * y + 2];
            if (soilMoisture_mm > 0.) {
              c.fillText('💧' + printSoilMoisture(soilMoisture_mm), 65, scrYpos + 17);
            }

            let snowHeight_cm = waterTextureValues[4 * y + 3];
            if (snowHeight_cm > 0.) {
              c.fillText('❄' + printSnowHeight(snowHeight_cm), 160, scrYpos + 17); // display snow height
            }
          } else if (wallTextureValues[4 * y + 0] == 2) {                          // is water
            c.fillStyle = 'lightblue';
            c.lineWidth = 1.0;
            let waterTempC = KtoC(potentialTemp);                                                           // water temperature is stored as absolute, not dependant on height
            c.fillText('🌊 🌡' + printTemp(waterTempC), T_to_Xpos(waterTempC, scrYpos) - 33, scrYpos + 17); // display water surface temperature
          }
        }
      }
      c.lineWidth = 2.0; // 3
      c.strokeStyle = '#FF0000';
      c.stroke();


      // Draw wind indicators
      c.beginPath();
      for (var y = surfaceLevel; y < sim_res_y; y++) {

        var scrYpos = map_range(y, sim_res_y, 0, 0, graphBottem);

        var velocity = rawVelocityTo_ms(baseTextureValues[4 * y]); // horizontal wind velocity

        let Xpos = this.graphCanvas.width - 70;

        c.moveTo(Xpos, scrYpos);
        c.lineTo(Xpos + velocity * 2.5, scrYpos); // draw line segment
      }

      c.lineWidth = 2.0; // 3
      c.strokeStyle = '#666666';
      c.stroke();


      // Draw Dew point line
      c.beginPath();
      for (var y = surfaceLevel; y < sim_res_y; y++) {

        if (wallTextureValues[4 * y + 1] != 0) { // fluid cell

          var temp = baseTextureValues[4 * y + 3] - ((y / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0 - 273.15;
          var dewPoint = KtoC(dewpoint(waterTextureValues[4 * y], CtoK(temp)));
          if (guiControls.realDewPoint) {
            dewPoint = Math.min(temp, dewPoint);
          }

          var scrYpos = map_range(y, sim_res_y, 0, 0, graphBottem);

          var velocity = rawVelocityTo_ms(Math.sqrt(Math.pow(baseTextureValues[4 * y], 2) + Math.pow(baseTextureValues[4 * y + 1], 2)));

          c.font = '15px Arial';
          c.fillStyle = 'white';

          // c.fillText('Surface: ' + y, 10, scrYpos);
          if (y == simYpos) {
            c.fillText('' + printAltitude(map_range(y - 1, 0, sim_res_y, 0, guiControls.simHeight)), 5, scrYpos + 5);

            c.fillText('' + printVelocity(velocity), this.graphCanvas.width - 113, scrYpos + 20);


            c.strokeStyle = '#FFF';
            c.lineWidth = 1.0;


            c.strokeRect(T_to_Xpos(dewPoint, scrYpos) - 10, scrYpos, 10,
                         1); // vertical position indicator
            c.fillText('' + printTemp(dewPoint), T_to_Xpos(dewPoint, scrYpos) - 70, scrYpos + 5);
          }

          c.lineTo(T_to_Xpos(dewPoint, scrYpos), scrYpos); // draw line segment
        }
      }

      c.lineWidth = 2.0; // 3
      c.strokeStyle = '#0055FF';
      c.stroke();

      // Draw rising parcel temperature line
      var water = waterTextureValues[4 * simYpos];
      var potentialTemp = baseTextureValues[4 * simYpos + 3];
      var initialTemperature = potentialTemp - ((simYpos / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0;
      var initialCloudWater = waterTextureValues[4 * simYpos + 1];
      // var temp = potentialTemp - ((y / sim_res_y) * guiControls.simHeight *
      // guiControls.dryLapseRate) / 1000.0 - 273.15;
      var prevTemp = initialTemperature;
      var prevCloudWater = initialCloudWater;

      var drylapsePerCell = ((-1.0 / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0;

      reachedSaturation = false;

      c.beginPath();
      var scrYpos = map_range(simYpos, sim_res_y, 0, 0, graphBottem);
      c.moveTo(T_to_Xpos(KtoC(initialTemperature), scrYpos), scrYpos);
      for (var y = simYpos + 1; y < sim_res_y; y++) {
        var dT = drylapsePerCell;

        var cloudWater = Math.max(water - maxWater(prevTemp + dT),
                                  0.0); // how much cloud water there would be after that
        // temperature change

        var dWt = (cloudWater - prevCloudWater) * guiControls.evapHeat; // how much that water phase change would
        // change the temperature

        var actualTempChange = dT_saturated(dT, dWt);

        var T = prevTemp + actualTempChange;

        var scrYpos = map_range(y, sim_res_y, 0, 0, graphBottem);

        c.lineTo(T_to_Xpos(KtoC(T), scrYpos), scrYpos); // temperature

        prevTemp = T;
        prevCloudWater = Math.max(water - maxWater(prevTemp), 0.0);

        if (!reachedSaturation && prevCloudWater > 0.0) {
          reachedSaturation = true;
          c.strokeStyle = '#008800'; // dark green for dry lapse rate
          c.stroke();

          if (y - simYpos > 5) {
            c.beginPath();
            c.moveTo(T_to_Xpos(KtoC(T), scrYpos) - 0, scrYpos); // temperature
            c.lineTo(T_to_Xpos(KtoC(T), scrYpos) + 40,
                     scrYpos);                                  // Horizontal ceiling line
            c.strokeStyle = '#FFFFFF';
            c.stroke();
            c.fillText('' + printAltitude(Math.round(map_range(y - 1, 0, sim_res_y, 0, guiControls.simHeight))), T_to_Xpos(KtoC(T), scrYpos) + 50, scrYpos + 5);
          }

          c.beginPath();
          c.moveTo(T_to_Xpos(KtoC(T), scrYpos), scrYpos); // temperature
        }
      }

      c.lineWidth = 2.0;           // 3
      if (reachedSaturation) {
        c.strokeStyle = '#00FF00'; // light green for saturated lapse rate
      } else
        c.strokeStyle = '#008800';

      c.stroke();


      c.fillText('' + printDistance(map_range(simXpos, 0, sim_res_y, 0, guiControls.simHeight)), this.graphCanvas.width - 70, 20);


      function T_to_Xpos(T, y)
      {
        // temperature to horizontal position
        var normX = T * 0.0115 + 1.18 - (y / graphBottem) * 0.8; // -30 to 50
        return normX * graphCanvas.width;                   // T * 7.5 + 780.0 - 600.0 * (y / graphBottem);
      }

      function drawIsotherms()
      {
        c.strokeStyle = '#964B00';
        c.beginPath();
        c.fillStyle = 'white';

        for (var T = -80.0; T <= 50.0; T += 10.0) {
          c.moveTo(T_to_Xpos(T, graphBottem), graphBottem);
          c.lineTo(T_to_Xpos(T, 0), 0);

          if (T >= -30.0)
            c.fillText(printTemp(Math.round(T)), T_to_Xpos(T, graphBottem) - 20, this.graphCanvas.height - 5);
        }
        c.lineWidth = 1.0;
        c.stroke();
        // draw 0 degree line thicker
        c.beginPath();
        c.moveTo(T_to_Xpos(0, graphBottem), graphBottem);
        c.lineTo(T_to_Xpos(0, 0), 0);
        c.lineWidth = 3.0;
        c.stroke();
      }
    }, // end of draw()
  };
  soundingGraph.init();

  await loadingBar.set(6, 'Setting up eventlisteners');
  // END OF GRAPH


  sim_aspect = sim_res_x / sim_res_y;

  var canvas_aspect;

  resizeCanvasAndPostFx();
  canvas.style.display = 'block';
  canvas_aspect = canvas.width / canvas.height;

  var mouseXinSim, mouseYinSim;
  var prevMouseXinSim, prevMouseYinSim;

  function handleViewportResize()
  {
    resizeCanvasAndPostFx();
    canvas_aspect = canvas.width / canvas.height;

    if (soundingGraph.graphCanvas) {
      const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      soundingGraph.graphCanvas.height = viewportHeight;
      soundingGraph.graphCanvas.width = viewportHeight;
    }
  }

  window.addEventListener('resize', handleViewportResize);
  window.addEventListener('orientationchange', handleViewportResize);
  if (window.visualViewport)
    window.visualViewport.addEventListener('resize', handleViewportResize);

  function logSample()
  {
    // mouse position in sim coordinates
    var simXpos = Math.floor(Math.abs(mod(mouseXinSim * sim_res_x, sim_res_x)));
    var simYpos = Math.min(Math.max(Math.floor(mouseYinSim * sim_res_y), 0), sim_res_y - 1);

    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);                                         // basetexture
    var baseTextureValues = new Float32Array(4);
    gl.readPixels(simXpos, simYpos, 1, 1, gl.RGBA, gl.FLOAT, baseTextureValues); // read single cell at mouse position

    // gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.readBuffer(gl.COLOR_ATTACHMENT1); // watertexture
    var waterTextureValues = new Float32Array(4);
    gl.readPixels(simXpos, simYpos, 1, 1, gl.RGBA, gl.FLOAT, waterTextureValues);

    gl.readBuffer(gl.COLOR_ATTACHMENT2); // walltexture
    var wallTextureValues = new Int8Array(4);
    gl.readPixels(simXpos, simYpos, 1, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues);

    gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); // lighttexture_1
    var lightTextureValues = new Float32Array(4);
    gl.readPixels(simXpos, simYpos, 1, 1, gl.RGBA, gl.FLOAT, lightTextureValues);

    gl.bindFramebuffer(gl.FRAMEBUFFER, precipitationFeedbackFrameBuff);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    var precipitationFeedbackTextureValues = new Float32Array(4);
    gl.readPixels(simXpos, simYpos, 1, 1, gl.RGBA, gl.FLOAT, precipitationFeedbackTextureValues);

    console.log(' ');
    console.log(' ');
    console.log('Sample at:      X: ' + simXpos + ' (' + simXpos * cellHeight / 1000 + ' km)', '  Y: ' + simYpos + ' (' + simYpos * cellHeight / 1000 + ' km)');
    console.log('BASE-----------------------------------------');
    console.log('[0] X-vel:', baseTextureValues[0]);
    console.log('[1] Y-vel:', baseTextureValues[1]);
    console.log('[2] Press:', baseTextureValues[2]);
    console.log('[3] Temp :', baseTextureValues[3].toFixed(2) + ' K   ', KtoC(baseTextureValues[3]).toFixed(2) + ' °C   ', KtoC(potentialToRealT(baseTextureValues[3], simYpos)).toFixed(2) + ' °C');

    console.log('WATER-----------------------------------------');
    console.log('[0] Water:     ', waterTextureValues[0]);
    console.log('[1] Cloudwater:', waterTextureValues[1]);
    console.log('[2] Soil Moisture / Precipitation:', waterTextureValues[2]);
    console.log('[3] Smoke/snow:', waterTextureValues[3]);

    console.log('WALL-----------------------------------------');
    console.log('[0] walltype :         ', wallTextureValues[0]);
    console.log('[1] distance:          ', wallTextureValues[1]);
    console.log('[2] Vertical distance :', wallTextureValues[2]);
    console.log('[3] Vegetation:        ', wallTextureValues[3]);

    console.log('LIGHT-----------------------------------------');
    console.log('[0] Sunlight:  ', lightTextureValues[0].toFixed(2), 'W/m²');
    console.log('[1] IR Heating:', (lightTextureValues[1] / 0.000002).toFixed(2), 'W/m²  (includes sunlight absorbed by smoke)'); // net effect of ir
    console.log('[2] IR down:   ', lightTextureValues[2].toFixed(2), 'W/m²', KtoC(IR_temp(lightTextureValues[2])).toFixed(2) + ' °C');
    console.log('[3] IR up:     ', lightTextureValues[3].toFixed(2), 'W/m²', KtoC(IR_temp(lightTextureValues[3])).toFixed(2) + ' °C');
    console.log('Net IR up:     ', (lightTextureValues[3] - lightTextureValues[2]).toFixed(2), 'W/m²');

    console.log('PRECIPITATION FEEDBACK-------------------------');
    console.log('[0] Mass:  ', precipitationFeedbackTextureValues[0]);
    console.log('[1] Heat:', precipitationFeedbackTextureValues[1]); // net effect of ir
    console.log('[2] Vapor:   ', precipitationFeedbackTextureValues[2]);
    console.log('[3] Snow deposition:     ', precipitationFeedbackTextureValues[3]);
  }


  var middleMousePressed = false;
  var leftMousePressed = false;
  var prevMouseX = 0;
  var prevMouseY = 0;
  var mouseX = 0;
  var mouseY = 0;
  var ctrlPressed = false;
  var rightCtrlPressed = false;
  var bPressed = false;
  var leftPressed = false;
  var downPressed = false;
  var rightPressed = false;
  var upPressed = false;
  var plusPressed = false;
  var minusPressed = false;
  var zPressed = false;


  // EVENT LISTENERS

  addEventListener('beforeunload', (event) => {
    if (new Date() - lastSaveTime > 120000) { // more than 120 seconds
      event.preventDefault();
      // custom message not showing for some reason
      confirm('Are you sure you want to quit without saving?');
      event.returnValue = 0; // Google Chrome requires returnValue to be set.
    }
  });

  window.addEventListener('wheel', function(event) {
    var delta = 0.1;
    if (event.deltaY > 0)
      delta *= -1;
    if (typeof lastWheel == 'undefined')
      lastWheel = 0; // init static variable
    const now = new Date().getTime();

    if (bPressed) {
      guiControls.brushSize *= 1.0 + delta * 1.0;
      if (guiControls.brushSize < 1)
        guiControls.brushSize = 1;
      else if (guiControls.brushSize > 200)
        guiControls.brushSize = 200;
    } else {
      if (now - lastWheel > 20) {
        // change zoom
        lastWheel = now;

        cam.zoomAtMousePos(delta);
      }
    }
  });

  window.addEventListener('mousemove', function(event) {
    var rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;

    if (!(guiControls.tool == 'TOOL_WALL_SEA' && leftMousePressed)) // lock y pos while drawing lake / sea
      mouseY = event.clientY - rect.top;

    if (middleMousePressed) {
      cam.changeViewXpos(((mouseX - prevMouseX) / cam.curZoom / canvas.width) * 2.0);
      cam.changeViewYpos(-((mouseY - prevMouseY) / cam.curZoom / canvas.width) * 2.0);
      prevMouseX = mouseX;
      prevMouseY = mouseY;
    }
  });

  canvas.addEventListener('mousedown', function(e) { mouseDownEvent(e); });
  if (soundingGraph.graphCanvas)
    soundingGraph.graphCanvas.addEventListener('mousedown', function(e) { mouseDownEvent(e); });


  function findSimYposAboveSurfaceAtMouseX() // find the lowest location that is not underground
  {
    let simXpos = clamp(Math.floor(mouseXinSim * sim_res_x), 0, sim_res_x - 1);
    let simYpos = clamp(Math.floor(mouseYinSim * sim_res_y), 0, sim_res_y - 1);
    // console.log(simYpos)

    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.readBuffer(gl.COLOR_ATTACHMENT2); // walltexture

    var wallTextureValues = new Int8Array(4 * sim_res_y);
    gl.readPixels(simXpos, 0, 1, sim_res_y, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues); // read a vertical culumn of cells

    if (wallTextureValues[simYpos * 4 + 1] > 0) {                                         // place at mouse position of cell is not wall
      return simYpos;
    } else {
      for (let curSimYpos = simYpos; curSimYpos < sim_res_y; curSimYpos++) { // find first cell above that is not wall
        if (wallTextureValues[curSimYpos * 4 + 1] > 0) {                     // surface reached
          return curSimYpos;
        }
      }
    }
  }

  function nearestLightningRod(simXpos, simYpos)
  {
    let bestIdx = -1;
    let bestDist = 1e9;
    for (let i = 0; i < lightningRods.length; i++) {
      const rod = lightningRods[i];
      const dxRaw = Math.abs(simXpos - rod.x);
      const dx = Math.min(dxRaw, sim_res_x - dxRaw);
      const dy = simYpos - rod.y;
      const d = Math.hypot(dx, dy);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return {idx : bestIdx, dist : bestDist};
  }

  function mouseDownEvent(e)
  {
    // event.preventDefault(); // caused problems with dat.gui
    // console.log('mousedown');
    if (e.button == 0) { // left
      leftMousePressed = true;
      if (SETUP_MODE) {
        startSimulation();
      } else if (guiControls.tool == 'TOOL_STATION') {
        let simXpos = Math.floor(mouseXinSim * sim_res_x);
        let simYpos = findSimYposAboveSurfaceAtMouseX();

        if (simXpos >= 0 && simXpos < sim_res_x) {
          if (ctrlPressed && weatherStations.length > 0) {
            let best = -1;
            let bestD = 1e9;
            for (let i = 0; i < weatherStations.length; i++) {
              let dx = Math.abs(weatherStations[i].getXpos() - simXpos);
              dx = Math.min(dx, sim_res_x - dx);
              let dy = weatherStations[i].getYpos() - simYpos;
              let d = Math.hypot(dx, dy);
              if (d < bestD) { bestD = d; best = i; }
            }
            if (best >= 0 && bestD <= Math.max(guiControls.brushSize * 0.5, 8.0))
              weatherStations[best].destroy();
          } else
            weatherStations.push(new Weatherstation(simXpos, simYpos)); // add weather station
        }
      } else if (guiControls.tool == 'TOOL_BALLOON') {
        let simXpos = Math.floor(mouseXinSim * sim_res_x);
        let simYpos = findSimYposAboveSurfaceAtMouseX();

        if (simXpos >= 0 && simXpos < sim_res_x) {
          if (ctrlPressed && weatherBalloons.length > 0) {
            let best = -1;
            let bestD = 1e9;
            for (let i = 0; i < weatherBalloons.length; i++) {
              let dx = Math.abs(weatherBalloons[i].x - simXpos);
              dx = Math.min(dx, sim_res_x - dx);
              let dy = weatherBalloons[i].y - simYpos;
              let d = Math.hypot(dx, dy);
              if (d < bestD) { bestD = d; best = i; }
            }
            if (best >= 0 && bestD <= Math.max(guiControls.brushSize * 0.75, 10.0))
              weatherBalloons[best].destroy();
          } else
            weatherBalloons.push(new WeatherBalloon(simXpos, simYpos));
        }
      } else if (guiControls.tool == 'TOOL_LIGHTNING_ROD') {
        let simXpos = Math.floor(mouseXinSim * sim_res_x);
        let simYpos = findSimYposAboveSurfaceAtMouseX();
        if (simXpos >= 0 && simXpos < sim_res_x) {
          if (ctrlPressed) {
            const nearest = nearestLightningRod(simXpos, simYpos);
            if (nearest.idx >= 0 && nearest.dist < guiControls.brushSize * 0.5)
              lightningRods.splice(nearest.idx, 1);
          } else {
            lightningRods.push({x : simXpos, y : simYpos});
            if (lightningRods.length > 8)
              lightningRods.shift();
          }
        }
      }
    } else if (e.button == 1) {
      // middle mouse button
      middleMousePressed = true;
      prevMouseX = mouseX;
      prevMouseY = mouseY;
    }
  }


  window.addEventListener('mouseup', function(event) {
    if (event.button == 0) {
      leftMousePressed = false;
    } else if (event.button == 1) {
      // middle mouse button
      middleMousePressed = false;
    }
  });


  var wasTwoFingerTouchBefore = false;

  var previousTouches;


  canvas.addEventListener('touchstart', function(event) { event.preventDefault(); }, {passive : false});

  canvas.addEventListener('touchend', function(event) {
    event.preventDefault();
    if (event.touches.length == 0) { // all fingers released
      leftMousePressed = false;
      //   }else if(event.touches.length == 1){
      wasTwoFingerTouchBefore = false;
      previousTouches = null;

      if (SETUP_MODE) {
        startSimulation();
      }
    }
  }, {passive : false});

  canvas.addEventListener('touchmove', function(event) {
    event.preventDefault();

    if (event.touches.length == 1) { // single finger

      // console.log(event.touches[0]);
      if (!wasTwoFingerTouchBefore) {
        leftMousePressed = true; // treat just like holding left mouse button
        mouseX = event.touches[0].clientX;
        mouseY = event.touches[0].clientY;
      }
    } else {
      leftMousePressed = false;

      if (event.touches.length == 2 && previousTouches && previousTouches.length == 2) // 2 finger zoom
      {
        mouseX = (event.touches[0].clientX + event.touches[1].clientX) / 2.0;          // position inbetween two fingers
        mouseY = (event.touches[0].clientY + event.touches[1].clientY) / 2.0;

        let prevXsep = previousTouches[0].clientX - previousTouches[1].clientX;
        let prevYsep = previousTouches[0].clientY - previousTouches[1].clientY;
        let prevSep = Math.sqrt(prevXsep * prevXsep + prevYsep * prevYsep);

        let curXsep = event.touches[0].clientX - event.touches[1].clientX;
        let curYsep = event.touches[0].clientY - event.touches[1].clientY;
        let curSep = Math.sqrt(curXsep * curXsep + curYsep * curYsep);

        cam.zoomAtMousePos((curSep / prevSep) - 1.0);

        if (wasTwoFingerTouchBefore) {
          cam.changeViewYpos(((mouseX - prevMouseX) / cam.curZoom / canvas.width) * 2.0);
          cam.changeViewYpos(((mouseY - prevMouseY) / cam.curZoom / canvas.width) * 2.0);
        }
        wasTwoFingerTouchBefore = true;
        prevMouseX = mouseX;
        prevMouseY = mouseY;
      }
    }

    previousTouches = event.touches;
  }, {passive : false});


  var lastBpressTime;

  function handlePause()
  {
    if (guiControls.paused) {
      soundSystem.mute();
    }
  }

  document.addEventListener('keydown', (event) => {
    if (event.code == 'ControlLeft') {
      ctrlPressed = true;
    }
    if (event.code == 'ControlRight') {
      // ctrl or cmd on mac
      rightCtrlPressed = true;
    } else if (event.code == 'Space') {
      // space bar
      guiControls.paused = !guiControls.paused;
      handlePause();
    } else if (event.code == 'KeyD') {
      // D
      guiControls.showDrops = !guiControls.showDrops;
    } else if (event.code == 'KeyB') {
      // B: scrolling to change brush size
      bPressed = true;
      if (new Date().getTime() - lastBpressTime < 300 && guiControls.tool != 'TOOL_NONE')
        // double pressed B
        guiControls.wholeWidth = !guiControls.wholeWidth; // toggle whole width brush

      // lastBpressTime = new Date().getTime();
    } else if (event.code == 'KeyF') {
      airplane.toggleCamFollow();
    } else if (event.code == 'KeyV') {
      // V: reset view to full simulation area
      cam.center();
    } else if (event.code == 'KeyG') {
      // G
      guiControls.showGraph = !guiControls.showGraph;
      hideOrShowGraph();
    } else if (event.code == 'Tab') {
      // TAB
      event.preventDefault();
      displayVectorField = !displayVectorField;
    } else if (event.code == 'KeyS') {
      // S: log sample at mouse location
      logSample();
    } else if (event.code == 'KeyZ') {
      zPressed = true;
    } else if (event.code == 'KeyX') {
      // Sample droplets around mouse location
      logDropletsAndToggleFollow();
    } else if (event.code == 'KeyA') {
      if (airplaneMode) {
        airplane.changeDirection();
      } else if (!SETUP_MODE)
        airplane.enableAirplaneMode(event.getModifierState('CapsLock'));
    } else if (event.code == 'CapsLock') {
      if (airplaneMode)
        airplane.setAutopilot(event.getModifierState('CapsLock'));
    } else if (event.code == 'ShiftLeft') {
      airplane.toggleGear();
    } else if (event.key == 1) { // number keys for displaymodes
      guiControls.displayMode = 'DISP_TEMPERATURE';
    } else if (event.key == 2) {
      guiControls.displayMode = 'DISP_WATER';
    } else if (event.key == 3) {
      guiControls.displayMode = 'DISP_REAL';
    } else if (event.key == 4) {
      guiControls.displayMode = 'DISP_HORIVEL';
    } else if (event.key == 5) {
      guiControls.displayMode = 'DISP_VERTVEL';
    } else if (event.key == 6) {
      guiControls.displayMode = 'DISP_IRHEATING';
    } else if (event.key == 7) {
      guiControls.displayMode = 'DISP_IRDOWNTEMP';
    } else if (event.key == 8) {
      guiControls.displayMode = 'DISP_IRUPTEMP';
    } else if (event.key == 9) {
      guiControls.displayMode = 'DISP_PRECIPFEEDBACK_MASS';
    } else if (event.key == 0) {
      guiControls.displayMode = 'DISP_PRECIPFEEDBACK_HEAT';
    } else if (event.code == 'KeyK') {
      guiControls.displayMode = 'DISP_AIRQUALITY';
    } else if (event.key == 'ArrowLeft') {
      leftPressed = true; // <
    } else if (event.key == 'ArrowUp') {
      if (!upPressed)
        airplane.onUpPressed();
      upPressed = true;    // ^
    } else if (event.key == 'ArrowRight') {
      rightPressed = true; // >
    } else if (event.key == 'ArrowDown') {
      if (!downPressed)
        airplane.onDownPressed();
      downPressed = true; // v
    } else if (event.key == '=' || event.key == '+') {
      event.preventDefault();
      plusPressed = true; // +
    } else if (event.key == '-') {
      event.preventDefault();
      minusPressed = true; // -
    } else if (event.code == 'Escape') {
      if (guiControls.tool == 'TOOL_NONE' && airplaneMode && confirm('Exit airplane mode?')) {
        airplane.disableAirplaneMode();
      } else {
        guiControls.tool = 'TOOL_NONE';
        guiControls.wholeWidth = false; // flashlight can't be whole width
      }
    } else if (event.code == 'KeyQ') {
      guiControls.tool = 'TOOL_TEMPERATURE';
    } else if (event.code == 'KeyW') {
      guiControls.tool = 'TOOL_WATER';
    } else if (event.code == 'KeyE') {
      guiControls.tool = 'TOOL_WALL_LAND';
    } else if (event.code == 'KeyR') {
      guiControls.tool = 'TOOL_WALL_SEA';
    } else if (event.code == 'KeyT') {
      guiControls.tool = 'TOOL_WALL_FIRE';
    } else if (event.code == 'KeyY') {
      guiControls.tool = 'TOOL_SMOKE';
    } else if (event.code == 'KeyU') {
      guiControls.tool = 'TOOL_WALL_MOIST';
    } else if (event.code == 'KeyI') {
      guiControls.tool = 'TOOL_VEGETATION';
    } else if (event.code == 'KeyO') {
      guiControls.tool = 'TOOL_WALL_SNOW';
    } else if (event.code == 'KeyP') {
      guiControls.tool = 'TOOL_WIND';
    } else if (event.code == 'BracketLeft') {
      guiControls.tool = 'TOOL_WALL_URBAN';
    } else if (event.code == 'BracketRight') {
      guiControls.tool = 'TOOL_WALL_RUNWAY';
    } else if (event.code == 'Backslash') {
      guiControls.tool = 'TOOL_WALL_INDUSTRIAL';
    } else if (event.code == 'KeyN') {
      if (displayWeatherStations) {
        displayWeatherStations = false;
        for (i = 0; i < weatherStations.length; i++) {
          weatherStations[i].setHidden(true);
        }
      } else {
        displayWeatherStations = true;
        for (i = 0; i < weatherStations.length; i++) {
          weatherStations[i].setHidden(false);
        }
      }

      if (guiControls.tool == 'TOOL_STATION') // prevent placing weather stations when not visible
        guiControls.tool = 'TOOL_NONE';
    } else if (event.code == 'KeyM') {
      guiControls.tool = 'TOOL_STATION';
      displayWeatherStations = true;
      for (i = 0; i < weatherStations.length; i++) {
        weatherStations[i].setHidden(false);
      }
    } else if (event.code == 'Period') {
      airplane.setBrakes(true);
    } else if (event.code == 'Slash') {
      airplane.toggleEngine();
    } else if (event.code == 'KeyL') {
      if (new Date() - lastSaveTime > 120000) // more than 120 seconds)
        if (!confirm('Are you sure you want to reload without saving?'))
          return;                             // abort

      // reload simulation
      if (initialRainDrops) { // if loaded from save file
        setupPrecipitationBuffers();
        setupTextures();
        gl.bindVertexArray(fluidVao);
        // iterNum = 0;
        // frameNum = 0;
      }
    } else if (event.code == 'PageUp') {
      adjIterPerFrame(1);
      guiControls.auto_IterPerFrame = false;
    } else if (event.code == 'PageDown') {
      adjIterPerFrame(-1);
      guiControls.auto_IterPerFrame = false;
    } else if (event.code == 'End') {
      guiControls.auto_IterPerFrame = true;
    } else if (event.code == 'Home') {
      guiControls.auto_IterPerFrame = false;
      guiControls.IterPerFrame = 1;
    }
  });

  document.addEventListener('keyup', (event) => {
    if (event.code == 'ControlLeft') {
      ctrlPressed = false;
    }
    if (event.code == 'ControlRight') {
      // ctrl or cmd on mac
      rightCtrlPressed = false;
    } else if (event.code == 'KeyB') {
      bPressed = false;
      lastBpressTime = new Date().getTime();
    } else if (event.code == 'KeyZ') {
      zPressed = false;
    } else if (event.key == 'ArrowLeft') {
      leftPressed = false;  // <
    } else if (event.key == 'ArrowUp') {
      upPressed = false;    // ^
    } else if (event.key == 'ArrowRight') {
      rightPressed = false; // >
    } else if (event.key == 'ArrowDown') {
      downPressed = false;  // v
    } else if (event.key == '=' || event.key == '+') {
      plusPressed = false;  // +
    } else if (event.key == '-') {
      minusPressed = false; // -
    } else if (event.code == 'Period') {
      airplane.setBrakes(false);
    }
  });

  await loadingBar.set(9, 'Setting up WebGL');

  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('EXT_float_blend');
  gl.getExtension('OES_texture_float_linear');
  gl.getExtension('OES_texture_half_float_linear');

  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  // gl.disable(gl.BLEND);
  // gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // load shaders
  var commonSource = await loadSourceFile('shaders/common.glsl');
  var commonDisplaySource = await loadSourceFile('shaders/commonDisplay.glsl');

  const simVertexShader = await loadShader('simShader.vert');
  const dispVertexShader = await loadShader('dispShader.vert');
  const realDispVertexShader = await loadShader('realDispShader.vert');
  const precipDisplayVertexShader = await loadShader('precipDisplayShader.vert');
  const postProcessingVertexShader = await loadShader('postProcessingShader.vert');

  const pressureShader = await loadShader('pressureShader.frag');
  const velocityShader = await loadShader('velocityShader.frag');
  const advectionShader = await loadShader('advectionShader.frag');
  const curlShader = await loadShader('curlShader.frag');
  const vorticityShader = await loadShader('vorticityShader.frag');
  const boundaryShader = await loadShader('boundaryShader.frag');

  const lightingShader = await loadShader('lightingShader.frag');

  const lightningLocationShader = await loadShader('lightningLocationShader.frag');

  const setupShader = await loadShader('setupShader.frag');

  const temperatureDisplayShader = await loadShader('temperatureDisplayShader.frag');
  const airQualityDisplayShader = await loadShader('airQualityDisplayShader.frag');
  const precipDisplayShader = await loadShader('precipDisplayShader.frag');
  const universalDisplayShader = await loadShader('universalDisplayShader.frag');
  const skyBackgroundDisplayShader = await loadShader('skyBackgroundDisplayShader.frag');
  const realisticDisplayShader = await loadShader('realisticDisplayShader.frag');
  const IRtempDisplayShader = await loadShader('IRtempDisplayShader.frag');

  const postProcessingShader = await loadShader('postProcessingShader.frag');
  const isolateBrightPartsShader = await loadShader('isolateBrightPartsShader.frag');
  const bloomBlurShader = await loadShader('bloomBlurShader.frag');


  // create programs
  const pressureProgram = createProgram(simVertexShader, pressureShader);
  const velocityProgram = createProgram(simVertexShader, velocityShader);
  const advectionProgram = createProgram(simVertexShader, advectionShader);
  const curlProgram = createProgram(simVertexShader, curlShader);
  const vorticityProgram = createProgram(simVertexShader, vorticityShader);
  const boundaryProgram = createProgram(simVertexShader, boundaryShader);

  const lightingProgram = createProgram(simVertexShader, lightingShader);

  const lightningLocationProgram = createProgram(simVertexShader, lightningLocationShader);

  const setupProgram = createProgram(simVertexShader, setupShader);

  const temperatureDisplayProgram = createProgram(dispVertexShader, temperatureDisplayShader);
  const airQualityDisplayProgram = createProgram(dispVertexShader, airQualityDisplayShader);
  const precipDisplayProgram = createProgram(precipDisplayVertexShader, precipDisplayShader);
  const universalDisplayProgram = createProgram(dispVertexShader, universalDisplayShader);
  const skyBackgroundDisplayProgram = createProgram(realDispVertexShader, skyBackgroundDisplayShader);
  const realisticDisplayProgram = createProgram(realDispVertexShader, realisticDisplayShader);
  const IRtempDisplayProgram = createProgram(dispVertexShader, IRtempDisplayShader);

  const postProcessingProgram = createProgram(postProcessingVertexShader, postProcessingShader);
  const isolateBrightPartsProgram = createProgram(postProcessingVertexShader, isolateBrightPartsShader);
  const bloomBlurProgram = createProgram(postProcessingVertexShader, bloomBlurShader);
  // const lightBlurProgram = createProgram(postProcessingVertexShader, bloomBlurShader);


  await loadingBar.set(80, 'Setting up textures');

  // // quad that fills the screen, so fragment shader is run for every pixel //
  // X, Y,  U, V  (x4)

  // Don't ask me why, but the * 1.0000001 is nesesary to get exactly round half
  // ( x.5 ) fragcoordinates in the fragmentshaders I figured this out
  // experimentally. It took me days! Without it the linear interpolation would
  // get fucked up because of the tiny offsets
  const fluidQuadVertices = [
    // X, Y,  U, V
    1.0,
    -1.0,
    sim_res_x * 1.0000001,
    0.0,
    -1.0,
    -1.0,
    0.0,
    0.0,
    1.0,
    1.0,
    sim_res_x * 1.0000001,
    sim_res_y * 1.0000001,
    -1.0,
    1.0,
    0.0,
    sim_res_y * 1.0000001,
  ];

  var fluidVao = gl.createVertexArray(); // vertex array object to store
  // bufferData and vertexAttribPointer
  gl.bindVertexArray(fluidVao);
  var fluidVertexBufferObject = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, fluidVertexBufferObject);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(fluidQuadVertices), gl.STATIC_DRAW);
  var positionAttribLocation = gl.getAttribLocation(pressureProgram,
                                                    'vertPosition'); // 0 these positions are the same for every program,
  // since they all use the same vertex shader
  var texCoordAttribLocation = gl.getAttribLocation(pressureProgram, 'vertTexCoord'); // 1
  gl.enableVertexAttribArray(positionAttribLocation);
  gl.enableVertexAttribArray(texCoordAttribLocation);
  gl.vertexAttribPointer(
    positionAttribLocation,             // Attribute location
    2,                                  // Number of elements per attribute
    gl.FLOAT,                           // Type of elements
    gl.FALSE,
    4 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
    0                                   // Offset from the beginning of a single vertex to this attribute
  );
  gl.vertexAttribPointer(
    texCoordAttribLocation,             // Attribute location
    2,                                  // Number of elements per attribute
    gl.FLOAT,                           // Type of elements
    gl.FALSE,
    4 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
    2 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
    // single vertex to this attribute
  );

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);


  const postProcessingQuadVertices = [
    1.0,  // X
    -1.0, // Y
    1.0,  // U
    0.0,  // V
    -1.0,
    -1.0,
    0.0,
    0.0,
    1.0,
    1.0,
    1.0,
    1.0,
    -1.0,
    1.0,
    0.0,
    1.0,
  ];

  var postProcessingVao = gl.createVertexArray(); // vertex array object to store
  // bufferData and vertexAttribPointer
  gl.bindVertexArray(postProcessingVao);
  var postProcessingVertexBufferObject = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, postProcessingVertexBufferObject);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(postProcessingQuadVertices), gl.STATIC_DRAW);
  positionAttribLocation = gl.getAttribLocation(postProcessingProgram,
                                                'vertPosition'); // 0 these positions are the same for every program,
  // since they all use the same vertex shader
  texCoordAttribLocation = gl.getAttribLocation(postProcessingProgram, 'vertTexCoord'); // 1
  gl.enableVertexAttribArray(positionAttribLocation);
  gl.enableVertexAttribArray(texCoordAttribLocation);
  gl.vertexAttribPointer(
    positionAttribLocation,             // Attribute location
    2,                                  // Number of elements per attribute
    gl.FLOAT,                           // Type of elements
    gl.FALSE,
    4 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
    0                                   // Offset from the beginning of a single vertex to this attribute
  );
  gl.vertexAttribPointer(
    texCoordAttribLocation,             // Attribute location
    2,                                  // Number of elements per attribute
    gl.FLOAT,                           // Type of elements
    gl.FALSE,
    4 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
    2 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
    // single vertex to this attribute
  );

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);


  // Precipitation setup

  const precipitationVertexShader = await loadShader('precipitationShader.vert');
  const precipitationShader = await loadShader('precipitationShader.frag');
  const precipitationProgram = createProgram(precipitationVertexShader, precipitationShader, [ 'position_out', 'mass_out', 'density_out' ]);

  gl.useProgram(precipitationProgram);

  const dropPositionAttribLocation = 0;
  const massAttribLocation = 1;
  const densityAttribLocation = 2;

  var even = true; // used to switch between precipitation buffers

  const precipitationVao_0 = gl.createVertexArray();
  const precipVertexBuffer_0 = gl.createBuffer();
  const precipitationTF_0 = gl.createTransformFeedback();
  const precipitationVao_1 = gl.createVertexArray();
  const precipVertexBuffer_1 = gl.createBuffer();
  const precipitationTF_1 = gl.createTransformFeedback();


  var rainDrops;

  function initRainDrops()
  {
    rainDrops = [];
    // generate inactive droplets with random values to be used as seeds for random spawning
    for (var i = 0; i < NUM_DROPLETS; i++) {
      // seperate push for each element is fastest
      rainDrops.push(Math.random());         // X
      rainDrops.push(Math.random());         // Y
      rainDrops.push(-10.0 + Math.random()); // water negative to disable
      rainDrops.push(Math.random());         // ice
      rainDrops.push(Math.random());         // density
    }
  }

  function setupPrecipitationBuffers()
  {
    gl.bindVertexArray(precipitationVao_0);

    gl.bindBuffer(gl.ARRAY_BUFFER, precipVertexBuffer_0);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(rainDrops), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionAttribLocation);
    gl.enableVertexAttribArray(massAttribLocation);
    gl.enableVertexAttribArray(densityAttribLocation);
    gl.vertexAttribPointer(
      dropPositionAttribLocation,         // Attribute location
      2,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
      0                                   // Offset from the beginning of a single vertex to this attribute
    );
    gl.vertexAttribPointer(
      massAttribLocation,                 // Attribute location
      2,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
      2 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );
    gl.vertexAttribPointer(
      densityAttribLocation,              // Attribute location
      1,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
      4 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, precipitationTF_0);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0,
                      precipVertexBuffer_0); // this binds the default (id = 0)
    // TRANSFORM_FEEBACK buffer
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

    // var precipitationVao_1 = gl.createVertexArray();
    gl.bindVertexArray(precipitationVao_1);

    gl.bindBuffer(gl.ARRAY_BUFFER, precipVertexBuffer_1);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(rainDrops), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionAttribLocation);
    gl.enableVertexAttribArray(massAttribLocation);
    gl.enableVertexAttribArray(densityAttribLocation);
    gl.vertexAttribPointer(
      dropPositionAttribLocation,         // Attribute location
      2,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
      0                                   // Offset from the beginning of a single vertex to this attribute
    );
    gl.vertexAttribPointer(
      massAttribLocation,                 // Attribute location
      2,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
      2 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );
    gl.vertexAttribPointer(
      densityAttribLocation,              // Attribute location
      1,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
      4 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, precipitationTF_1);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0,
                      precipVertexBuffer_1); // this binds the default (id = 0)
    // TRANSFORM_FEEBACK buffer
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

    gl.bindBuffer(gl.ARRAY_BUFFER, null); // buffers are bound via VAO's
    gl.bindVertexArray(fluidVao);         // set screenfilling rect again
  }


  const valsPerDroplet = 5;

  function logDropletsAndToggleFollow()
  {
    if (dropletFollowID >= 0) { // disable follow droplet
      dropletFollowID = -1;
      let dropletInfoCanvas = getEl('dropletInfoCanvas');
      if (dropletInfoCanvas)
        dropletInfoCanvas.style.display = 'none';
      return;
    }

    // log data of all the droplets within the brush
    let tempDroplets = new Float32Array(valsPerDroplet * NUM_DROPLETS);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, even ? precipVertexBuffer_0 : precipVertexBuffer_1); // x, y, water, ice, density
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, tempDroplets);

    console.log(' ');
    console.log(' ');
    console.log('DROPLETS:-----------------------------------------');
    console.log(' ');

    let numInBrush = 0;
    let duplicates = 0;

    for (let n = 0; n < NUM_DROPLETS; n++) {
      let i = n * valsPerDroplet;
      let X = tempDroplets[i + 0];
      let Y = tempDroplets[i + 1];
      let x = (X + 1.0) / 2.0;
      let y = (Y + 1.0) / 2.0;
      let water = tempDroplets[i + 2];
      let ice = tempDroplets[i + 3];
      let density = tempDroplets[i + 4];

      let dx = (mouseXinSim - x) * sim_aspect;
      let dy = mouseYinSim - y;
      let dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < guiControls.brushSize / 2.0 / sim_res_y && water >= 0) { // if droplet is within the brush and active
        console.log('n:', n);
        console.log('x:', x);
        console.log('y:', y);
        console.log('water:', water);
        console.log('Ice:', ice);
        console.log('Density:', density);
        console.log(' ');
        numInBrush++;


        if (numInBrush == 1) { // first droplet found
          dropletFollowID = n;
          dropletInfoCanvas.style.display = 'block';
        }
      }
      /*
        // check for duplicates. Very slow!
        if (n < NUM_DROPLETS - 1) {
          for (let d = n + 1; d < NUM_DROPLETS; d++) {
            let j = d * valsPerDroplet;
            if (X == tempDroplets[j + 0] && Y == tempDroplets[j + 1]) {
              duplicates++;
              break;
            }
          }
        }
      */
    }
    console.log(NUM_DROPLETS, 'total droplets. ', numInBrush, 'droplets logged. ', duplicates, ' duplicates found');


    // dropletFollowMode = true;
  }


  function readDropletData(n)
  {
    let i = n * valsPerDroplet;
    let byteOffset = i * 4; // Convert to byte offset

    let dropletData = new Float32Array(valsPerDroplet);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, even ? precipVertexBuffer_0 : precipVertexBuffer_1);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, byteOffset, dropletData, 0, valsPerDroplet);

    dropletData[0] = (dropletData[0] + 1.0) / 2.0;
    dropletData[1] = (dropletData[1] + 1.0) / 2.0;

    // let x = dropletData[0];
    // let y = dropletData[1];
    // let water = dropletData[2];
    // let ice = dropletData[3];
    // let density = dropletData[4];

    // console.log('Droplet ', n);
    // console.log('x:', x);
    // console.log('y:', y);
    // console.log('water:', water);
    // console.log('Ice:', ice);
    // console.log('Density:', density);
    // console.log(' ');

    return dropletData;
  }


  if (initialRainDrops) {
    rainDrops = initialRainDrops;
  } else {
    initRainDrops();
  }

  setupPrecipitationBuffers();


  /*

  TEXTURE DESCRIPTIONS

  base texture: RGBA32F
  [0] = Horizontal velocity                              -1.0 to 1.0
  [1] = Vertical   velocity                              -1.0 to 1.0
  [2] = Pressure                                          >= 0
  [3] = Temperature in air, indicator in wall

  water texture: RGBA32F
  [0] = total water                                        >= 0
  [1] = cloud water                                        >= 0
  [2] = precipitation in air, moisture in surface          >= 0
  [3] = smoke/dust in air, snow in surface                 >= 0 for smoke/dust
  0 to 100 for snow

  wall texture: RGBA8I
  [0] walltype
  [1] manhattan distance to nearest wall                   0 to 127
  [2] height above/below ground. Surface = 0               -127 to 127
  [3] vegetation                                           0 to 127     grass from 0 to 50, trees from 50 to 127

  lighting texture: RGBA32F
  [0] sunlight                                             0 to 1.0
  [1] net heating effect of IR + sun absorbed by smoke
  [2] IR coming down                                       >= 0
  [3] IR going  up                                         >= 0

  */

  const baseTexture_0 = gl.createTexture();
  const baseTexture_1 = gl.createTexture();
  const waterTexture_0 = gl.createTexture();
  const waterTexture_1 = gl.createTexture();
  const wallTexture_0 = gl.createTexture();
  const wallTexture_1 = gl.createTexture();

  const curlTexture = gl.createTexture();
  const vortForceTexture = gl.createTexture();

  const lightTexture_0 = gl.createTexture();
  const lightTexture_1 = gl.createTexture();
  const precipitationFeedbackTexture = gl.createTexture();
  const precipitationDepositionTexture = gl.createTexture();
  const lightningDataTexture = gl.createTexture(); // single pixel texture holding location and timing of current lightning strike

  // Static texures:
  const noiseTexture = gl.createTexture();
  const A380Texture = gl.createTexture();
  const A380_R_Texture = gl.createTexture();
  const A380GearTexture = gl.createTexture();
  const surfaceTextureMap = gl.createTexture();
  const colorScalesTexture = gl.createTexture();

  const lightningTextures = [];
  const numLightningTextures = 10;


  frameBuff_0 = gl.createFramebuffer(); // global for weather stations
  const frameBuff_1 = gl.createFramebuffer();

  const curlFrameBuff = gl.createFramebuffer();
  const vortForceFrameBuff = gl.createFramebuffer();

  lightFrameBuff_0 = gl.createFramebuffer();
  const lightFrameBuff_1 = gl.createFramebuffer();
  const precipitationFeedbackFrameBuff = gl.createFramebuffer();
  const lightningDataFrameBuff = gl.createFramebuffer();

  // Set up Textures
  async function setupTextures()
  {
    gl.bindTexture(gl.TEXTURE_2D, baseTexture_0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, initialBaseTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, initialBaseTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    gl.bindTexture(gl.TEXTURE_2D, waterTexture_0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, initialWaterTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, initialWaterTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    gl.bindTexture(gl.TEXTURE_2D, wallTexture_0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8I, sim_res_x, sim_res_y, 0, gl.RGBA_INTEGER, gl.BYTE, initialWallTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    //  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8I, sim_res_x, sim_res_y, 0, gl.RGBA_INTEGER, gl.BYTE, initialWallTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    lastSaveTime = new Date();
  }

  setupTextures();

  createAmbientLightFBOs();

  // Set up Framebuffers


  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, baseTexture_0, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, waterTexture_0, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, wallTexture_0, 0);


  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, baseTexture_1, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, waterTexture_1, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, wallTexture_1, 0);


  gl.bindTexture(gl.TEXTURE_2D, curlTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, sim_res_x, sim_res_y, 0, gl.RED, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, curlFrameBuff);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, curlTexture,
                          0); // attach the texture as the first color attachment


  gl.bindTexture(gl.TEXTURE_2D, vortForceTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, sim_res_x, sim_res_y, 0, gl.RG, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, vortForceFrameBuff);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, vortForceTexture, 0);

  gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT,
                null);                                               // HALF_FLOAT before, but problems with acuracy
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,
                   gl.CLAMP_TO_EDGE); // prevent light from shining trough at bottem or top

  gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightTexture_0, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, emittedLightFBO.texture, 0);


  gl.bindTexture(gl.TEXTURE_2D, lightTexture_1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);    // LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); // prevent light from shining trough at bottem or top

  gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_1);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightTexture_1, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, emittedLightFBO.texture, 0);


  gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindTexture(gl.TEXTURE_2D, precipitationDepositionTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, sim_res_x, sim_res_y, 0, gl.RG, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, precipitationFeedbackFrameBuff);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, precipitationFeedbackTexture, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, precipitationDepositionTexture, 0);

  gl.bindTexture(gl.TEXTURE_2D, lightningDataTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, lightningDataFrameBuff);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightningDataTexture, 0);

  // load images
  imgElement = await loadImage('resources/img/noise_texture.jpg');

  gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgElement);

  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // gl.texParameteri(
  //     gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,
  //     gl.REPEAT);  // default, so no need to set
  // gl.texParameteri(
  //     gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,
  //     gl.REPEAT);  // default, so no need to set

  imgElement = await loadImage('resources/img/A380.png');

  gl.bindTexture(gl.TEXTURE_2D, A380Texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgElement);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); // LINEAR_MIPMAP_LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);            // CLAMP_TO_EDGE
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);            // REPEAT
                                                                                   // NEAREST_MIPMAP_LINEAR create weird effects

  imgElement = await loadImage('resources/img/A380_R.png');

  gl.bindTexture(gl.TEXTURE_2D, A380_R_Texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgElement);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); // LINEAR_MIPMAP_LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);            // CLAMP_TO_EDGE
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);            // REPEAT

  imgElement = await loadImage('resources/img/A380_gear.png');

  gl.bindTexture(gl.TEXTURE_2D, A380GearTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgElement);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); // LINEAR_MIPMAP_LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);            // CLAMP_TO_EDGE
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);            // REPEAT

  imgElement = await loadImage('resources/img/surfaceTextureMap.png');

  gl.bindTexture(gl.TEXTURE_2D, surfaceTextureMap);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgElement);
  // gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);        // horizontal
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); // vertical


  imgElement = await loadImage('resources/img/ColorScales.png');

  gl.bindTexture(gl.TEXTURE_2D, colorScalesTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgElement);
  // gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);        // horizontal
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); // vertical


  function downloadImageData(imgData)
  {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    canvas.width = imgData.width;
    canvas.height = imgData.height
    ctx.putImageData(imgData, 0, 0);
    var dataUrl = canvas.toDataURL('image/png');
    var link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'Lightning_image.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }


  function generateLightningTexture(i, imgData)
  {
    lightningTextures[i] = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, lightningTextures[i]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, imgData.width, imgData.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, imgData);
    // gl.generateMipmap(gl.TEXTURE_2D);                                                // optional
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // LINEAR_MIPMAP_LINEAR
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  }


  const lightningGeneratorWorker = new Worker('./lightningGenerator.js');
  const lightningTextureTasks = [];
  const pendingLightningTextureRequests = new Map();

  lightningGeneratorWorker.onmessage = (event) => {
    const payload = event.data || {};
    const pending = pendingLightningTextureRequests.get(payload.id);
    if (!pending)
      return;

    pendingLightningTextureRequests.delete(payload.id);
    // downloadImageData(payload.imageData); // for debugging
    generateLightningTexture(pending.textureIndex, payload.imageData);
    pending.resolve();
  };

  const lightningTextureWidth = isMobileLikeDevice() ? 1400 : 2500;
  const lightningTextureHeight = isMobileLikeDevice() ? 2800 : 5000;

  for (let i = 0; i < numLightningTextures; i++) {
    lightningTextureTasks.push(new Promise((resolve) => {
      const reqId = i + 1;
      pendingLightningTextureRequests.set(reqId, {resolve, textureIndex : i});
      lightningGeneratorWorker.postMessage({
        id : reqId,
        width : lightningTextureWidth,
        height : lightningTextureHeight,
        seed : (Date.now() + i * 2654435761) >>> 0
      });
    }));
  }

  await Promise.all(lightningTextureTasks);
  lightningGeneratorWorker.terminate();

  await loadingBar.set(90, 'Setting up FBO`s');

  createHdrFBO();

  createBloomFBOs();

  var texelSizeX = 1.0 / sim_res_x;
  var texelSizeY = 1.0 / sim_res_y;

  dryLapse = (guiControls.simHeight * guiControls.dryLapseRate) / 1000.0; // total lapse rate from bottem to top of atmosphere


  // generate sounding data for forcing in sim

  var realWorldSounding_T = new Float32Array(504);   // sim_res_y + 1
  var realWorldSounding_W = new Float32Array(504);   // sim_res_y + 1
  var realWorldSounding_Vel = new Float32Array(504); // sim_res_y + 1
  if (soundingData && soundingData.length > 10) {
    var soundingForSim = rawSoundingToSimSounding(soundingData, guiControls.simHeight, sim_res_y + 1);

    for (var y = 0; y < sim_res_y + 1; y++) {

      let soundingSample = soundingForSim[y];

      realWorldSounding_T[y] = realToPotentialT(CtoK(soundingSample.t), y); // initial temperature profile
      realWorldSounding_W[y] = maxWater(CtoK(soundingSample.td), y);        // initial temperature profile
      realWorldSounding_Vel[y] = soundingSample.vel;
    }
    // console.log(realWorldSounding_T);
    // console.log(realWorldSounding_W);
    // console.log(realWorldSounding_Vel);
  } else {
    console.log('No valid sounding loaded!');
  }

  // generate Initial temperature profile

  var initial_T = new Float32Array(504); // sim_res_y + 1

  for (var y = 0; y < sim_res_y + 1; y++) {
    let altitude = y / (sim_res_y + 1) * guiControls.simHeight;
    var realTemp = Math.max(map_range(altitude, 0, 12000, 15.0, -70.0), -60);

    initial_T[y] = realToPotentialT(CtoK(realTemp), y); // initial temperature profile
  }

  cellHeight = guiControls.simHeight / sim_res_y; // in meters

  // Set constant uniforms
  gl.useProgram(setupProgram);
  gl.uniform2f(gl.getUniformLocation(setupProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform2f(gl.getUniformLocation(setupProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform1f(gl.getUniformLocation(setupProgram, 'dryLapse'), dryLapse);
  gl.uniform1f(gl.getUniformLocation(setupProgram, 'simHeight'), guiControls.simHeight);

  gl.uniform4fv(gl.getUniformLocation(setupProgram, 'initial_Tv'), initial_T);

  gl.useProgram(advectionProgram);
  gl.uniform1i(gl.getUniformLocation(advectionProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(advectionProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(advectionProgram, 'wallTex'), 2);
  gl.uniform2f(gl.getUniformLocation(advectionProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform2f(gl.getUniformLocation(advectionProgram, 'resolution'), sim_res_x, sim_res_y);
  // gl.uniform1fv(
  // gl.getUniformLocation(advectionProgram, 'initial_T'), initial_T);
  gl.uniform4fv(gl.getUniformLocation(advectionProgram, 'initial_Tv'), initial_T);
  gl.uniform1f(gl.getUniformLocation(advectionProgram, 'dryLapse'), dryLapse);
  gl.uniform1f(gl.getUniformLocation(advectionProgram, 'waterTemperature'),
               CtoK(guiControls.waterTemperature)); // can be changed by GUI input

  gl.uniform4fv(gl.getUniformLocation(advectionProgram, 'realWorldSounding_Tv'), realWorldSounding_T);
  gl.uniform4fv(gl.getUniformLocation(advectionProgram, 'realWorldSounding_Wv'), realWorldSounding_W);
  gl.uniform4fv(gl.getUniformLocation(advectionProgram, 'realWorldSounding_Velv'), realWorldSounding_Vel);

  gl.useProgram(pressureProgram);
  gl.uniform1i(gl.getUniformLocation(pressureProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(pressureProgram, 'wallTex'), 1);
  gl.uniform2f(gl.getUniformLocation(pressureProgram, 'texelSize'), texelSizeX, texelSizeY);

  gl.useProgram(velocityProgram);
  gl.uniform1i(gl.getUniformLocation(velocityProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(velocityProgram, 'wallTex'), 1);
  gl.uniform1i(gl.getUniformLocation(velocityProgram, 'waterTex'), 2);
  gl.uniform2f(gl.getUniformLocation(velocityProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1f(gl.getUniformLocation(velocityProgram, 'coriolisStrength'), guiControls.coriolisStrength);
  gl.uniform1f(gl.getUniformLocation(velocityProgram, 'turbulentMix'), guiControls.turbulentMix);
  gl.uniform1f(gl.getUniformLocation(velocityProgram, 'jetStreamCoupling'), guiControls.jetStreamCoupling);
  gl.uniform1f(gl.getUniformLocation(velocityProgram, 'moistBuoyancyBoost'), guiControls.moistBuoyancyBoost);
  gl.uniform1f(gl.getUniformLocation(velocityProgram, 'gravityCurrentStrength'), guiControls.gravityCurrentStrength);
  gl.uniform1f(gl.getUniformLocation(velocityProgram, 'shearProduction'), guiControls.shearProduction);
  gl.uniform1f(gl.getUniformLocation(velocityProgram, 'tornadoPotential'), guiControls.tornadoPotential);
  gl.uniform1f(gl.getUniformLocation(velocityProgram, 'frontogenesisStrength'), guiControls.frontogenesisStrength);
  gl.uniform1f(gl.getUniformLocation(velocityProgram, 'supercellHelicity'), guiControls.supercellHelicity);
  gl.uniform1f(gl.getUniformLocation(velocityProgram, 'mesocycloneFeedback'), guiControls.mesocycloneFeedback);
  gl.uniform1f(gl.getUniformLocation(velocityProgram, 'stormRelativeInflow'), guiControls.stormRelativeInflow);
  gl.uniform1f(gl.getUniformLocation(velocityProgram, 'occlusionDowndraftCoupling'), guiControls.occlusionDowndraftCoupling);

  // gl.uniform1fv(gl.getUniformLocation(velocityProgram, 'initial_T'), initial_T);
  gl.uniform4fv(gl.getUniformLocation(velocityProgram, 'initial_Tv'), initial_T);

  gl.useProgram(vorticityProgram);
  gl.uniform2f(gl.getUniformLocation(vorticityProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(vorticityProgram, 'curlTex'), 0);

  gl.useProgram(boundaryProgram);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'vortForceTex'), 2);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'wallTex'), 3);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'lightTex'), 4);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'precipFeedbackTex'), 5);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'precipDepositionTex'), 6);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'lightningDataTex'), 7);
  gl.uniform2f(gl.getUniformLocation(boundaryProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(boundaryProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'vorticity'),
               guiControls.vorticity);              // can be changed by GUI input
  gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterTemperature'),
               CtoK(guiControls.waterTemperature)); // can be changed by GUI input
  gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'dryLapse'), dryLapse);
  gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'precipitationRecycling'), guiControls.precipitationRecycling);
  gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'coastalMixing'), guiControls.coastalMixing);
  gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterAlbedoShift'), guiControls.waterAlbedoShift);
  gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'cloudLifetimeBoost'), guiControls.cloudLifetimeBoost);
  // gl.uniform1fv(gl.getUniformLocation(boundaryProgram, 'initial_T'), initial_T);
  gl.uniform4fv(gl.getUniformLocation(boundaryProgram, 'initial_Tv'), initial_T);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'allowCaves'), guiControls.allowCaves ? 1 : 0);

  gl.useProgram(curlProgram);
  gl.uniform2f(gl.getUniformLocation(curlProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(curlProgram, 'baseTex'), 0);

  gl.useProgram(lightingProgram);
  gl.uniform2f(gl.getUniformLocation(lightingProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(lightingProgram, 'texelSize'), texelSizeX, texelSizeY);

  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'lightTex'), 3);
  gl.uniform1f(gl.getUniformLocation(lightingProgram, 'dryLapse'), dryLapse);

  // Display programs:
  gl.useProgram(temperatureDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(temperatureDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(temperatureDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(temperatureDisplayProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(temperatureDisplayProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(temperatureDisplayProgram, 'colorScalesTex'), 9);
  gl.uniform1f(gl.getUniformLocation(temperatureDisplayProgram, 'dryLapse'), dryLapse);

  gl.useProgram(airQualityDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(airQualityDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(airQualityDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(airQualityDisplayProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(airQualityDisplayProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(airQualityDisplayProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(airQualityDisplayProgram, 'colorScalesTex'), 9);
  gl.uniform1f(gl.getUniformLocation(airQualityDisplayProgram, 'dryLapse'), dryLapse);

  gl.useProgram(precipDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(precipDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(precipDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(precipDisplayProgram, 'waterTex'), 0);
  gl.uniform1i(gl.getUniformLocation(precipDisplayProgram, 'wallTex'), 2);

  gl.useProgram(skyBackgroundDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'simHeight'), guiControls.simHeight);
  gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'minShadowLight'), minShadowLight);
  gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'lightTex'), 3);
  gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'ambientLightTex'), 9);
  gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'precipFeedbackTex'), 7);
  gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'planeTex'), 8);
  gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'planeGearTex'), 10);

  gl.useProgram(universalDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(universalDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(universalDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'anyTex'), 0);
  gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'wallTex'), 2);

  gl.useProgram(realisticDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(realisticDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(realisticDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'minShadowLight'), minShadowLight);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'lightTex'), 3);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'noiseTex'), 4);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'surfaceTextureMap'), 5);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'curlTex'), 6);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'lightningTex'), 7);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'lightningDataTex'), 8);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'ambientLightTex'), 9);
  gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'dryLapse'), dryLapse);
  gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'cellHeight'), cellHeight);
  gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningColorTempMult'), guiControls.lightningColorTempMult);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'electricFieldVizStrength'), guiControls.electricFieldVizStrength);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'dynamicChargeSeparation'), guiControls.dynamicChargeSeparation);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'electricFieldDiffusion'), guiControls.electricFieldDiffusion);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'mobileLightningVisibility'), getMobileLightningVisibility());
    gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'showLightningRods'), guiControls.showLightningRods ? 1 : 0);

  gl.useProgram(precipitationProgram);
  gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'lightningDataTex'), 2);
  gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'wallTex'), 3);
  gl.uniform2f(gl.getUniformLocation(precipitationProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(precipitationProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'dryLapse'), dryLapse);
  gl.uniform4f(gl.getUniformLocation(precipitationProgram, 'userInputValues'), -2.0, -2.0, 0.0, 0.0);
  gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'userInputType'), -1);
  gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'lightningCloudLinkRadiusNorm'), clamp(100000.0 / Math.max(cellHeight * sim_res_x, 1.0), 0.02, 0.45));
  gl.useProgram(IRtempDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(IRtempDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(IRtempDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(IRtempDisplayProgram, 'lightTex'), 0);
  gl.uniform1i(gl.getUniformLocation(IRtempDisplayProgram, 'wallTex'), 2);

  gl.useProgram(postProcessingProgram);
  gl.uniform1i(gl.getUniformLocation(postProcessingProgram, 'hdrTex'), 0);
  gl.uniform1i(gl.getUniformLocation(postProcessingProgram, 'bloomTex'), 1);
  gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'motionBlurStrength'), 0.0);


  gl.useProgram(isolateBrightPartsProgram);
  gl.uniform1i(gl.getUniformLocation(isolateBrightPartsProgram, 'hdrTex'), 0);

  gl.useProgram(lightningLocationProgram);
  gl.uniform1i(gl.getUniformLocation(lightningLocationProgram, 'precipFeedbackTex'), 0);
  gl.uniform2f(gl.getUniformLocation(lightningLocationProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(lightningLocationProgram, 'texelSize'), texelSizeX, texelSizeY);


  // console.time('Set uniforms');
  setGuiUniforms(); // all uniforms changed by gui
  updateLightningRodUniforms();
  // console.timeEnd('Set uniforms')

  gl.bindVertexArray(fluidVao);

  // if no save file was loaded
  // Use setup shader to set initial conditions
  if (initialWallTex == null) {
    gl.viewport(0, 0, sim_res_x, sim_res_y);
    gl.useProgram(setupProgram);
    // Render to both framebuffers
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
    gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }


  if (!SETUP_MODE) {
    startSimulation();
  }

  if (guiControls.sound) {
    soundSystem = new SoundSystem();
  }

  await loadingBar.set(95, 'Loading sounds and generating lightning textures'); // loading complete
  await loadingBar.remove();

  var srcVAO;
  var destVAO;
  var destTF;

  // preload uniform locations for tiny performance gain
  var uniformLocation_boundaryProgram_iterNum = gl.getUniformLocation(boundaryProgram, 'iterNum');
  var uniformLocation_precipitationProgram_iterNum = gl.getUniformLocation(precipitationProgram, 'iterNum');
  var uniformLocation_precipitationProgram_inactiveDroplets = gl.getUniformLocation(precipitationProgram, 'inactiveDroplets');
  var uniformLocation_lightningLocationProgram_iterNum = gl.getUniformLocation(lightningLocationProgram, 'iterNum');


  for (i = 0; i < weatherStations.length; i++) { // initial measurement at weather stations
    weatherStations[i].measure();
  }

  setInterval(calcFps, 1000); // log fps
  requestAnimationFrame(draw);

  function draw()
  { // Runs for every frame
    let camPanSpeed = guiControls.camSpeed;

    if (rightCtrlPressed) {
      camPanSpeed *= 0.2;
    }

    if (!airplaneMode) {
      if (upPressed) {
        // ^
        cam.changeViewYpos(-camPanSpeed / cam.curZoom);
      }
      if (downPressed) {
        // v
        cam.changeViewYpos(camPanSpeed / cam.curZoom);
      }
    }
    if (leftPressed) {
      // <
      cam.changeViewXpos(camPanSpeed / cam.curZoom);
    }
    if (rightPressed) {
      // >
      cam.changeViewXpos(-camPanSpeed / cam.curZoom);
    }
    if (plusPressed) {
      // +
      cam.changeViewZoom(camPanSpeed);
    }
    if (minusPressed) {
      // -
      cam.changeViewZoom(-camPanSpeed);
    }

    cam.move();

    prevMouseXinSim = mouseXinSim;
    prevMouseYinSim = mouseYinSim;

    mouseXinSim = screenToSimX(mouseX);
    mouseYinSim = screenToSimY(mouseY);

    if (SETUP_MODE) {
      gl.disable(gl.BLEND);
      gl.viewport(0, 0, sim_res_x, sim_res_y);
      gl.useProgram(setupProgram);
      gl.uniform1f(gl.getUniformLocation(setupProgram, 'seed'), mouseXinSim);
      gl.uniform1f(gl.getUniformLocation(setupProgram, 'heightMult'), ((canvas.height - mouseY) / canvas.height) * 2.0);
      gl.uniform1f(gl.getUniformLocation(setupProgram, 'terrainRuggednessBoost'), guiControls.terrainRuggednessBoost);
      gl.uniform1f(gl.getUniformLocation(setupProgram, 'terrainWetnessRecovery'), guiControls.terrainWetnessRecovery);
      gl.uniform1f(gl.getUniformLocation(setupProgram, 'terrainRiverBias'), guiControls.terrainRiverBias);
      // Render to both framebuffers
      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
      gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
      gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      // NOT SETUP MODE:

      // gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.useProgram(advectionProgram);

      var inputType = -1;
      if (leftMousePressed) {
        if (guiControls.tool == 'TOOL_NONE')
          inputType = 0; // only flashlight on
        else if (guiControls.tool == 'TOOL_TEMPERATURE')
          inputType = 1;
        else if (guiControls.tool == 'TOOL_WATER')
          inputType = 2;
        else if (guiControls.tool == 'TOOL_SMOKE')
          inputType = 3;
        else if (guiControls.tool == 'TOOL_SAND')
          inputType = 23;
        else if (guiControls.tool == 'TOOL_WIND')
          inputType = 4;
        else if (guiControls.tool == 'TOOL_WALL')
          inputType = 10;
        else if (guiControls.tool == 'TOOL_WALL_LAND')
          inputType = 11;
        else if (guiControls.tool == 'TOOL_WALL_SEA')
          inputType = 12;
        else if (guiControls.tool == 'TOOL_WALL_FIRE')
          inputType = 13;
        else if (guiControls.tool == 'TOOL_WALL_URBAN')
          inputType = 14;
        else if (guiControls.tool == 'TOOL_WALL_RUNWAY')
          inputType = 15;
        else if (guiControls.tool == 'TOOL_WALL_INDUSTRIAL')
          inputType = 16;
        else if (guiControls.tool == 'TOOL_SKYSCRAPER')
          inputType = 24;
        else if (guiControls.tool == 'TOOL_LIGHTNING_ROD')
          inputType = -1;
        else if (guiControls.tool == 'TOOL_ARTIFICIAL_LIGHTNING')
          inputType = 25;

        // Surface environment modifiers
        else if (guiControls.tool == 'TOOL_WALL_MOIST')
          inputType = 20;
        else if (guiControls.tool == 'TOOL_WALL_SNOW')
          inputType = 21;
        else if (guiControls.tool == 'TOOL_VEGETATION')
          inputType = 22;

        var intensity = guiControls.brushIntensity;
        if (guiControls.tool == 'TOOL_SAND')
          intensity *= 1.8;

        if (ctrlPressed) {
          intensity *= -1;
        }

        var posXinSim;

        if (guiControls.wholeWidth)
          posXinSim = -1.0;
        else if (guiControls.wrapHorizontally)
          posXinSim = mod(mouseXinSim, 1.0); // wrap mouse position around borders
        else
          posXinSim = clamp(mouseXinSim, 0.0, 1.0);


        let moveX = mouseXinSim - prevMouseXinSim;
        let moveY = mouseYinSim - prevMouseYinSim;

        gl.uniform4f(gl.getUniformLocation(advectionProgram, 'userInputValues'), posXinSim, mouseYinSim, intensity, guiControls.brushSize * 0.5);
        gl.uniform2f(gl.getUniformLocation(advectionProgram, 'userInputMove'), moveX, moveY);
        gl.uniform1i(gl.getUniformLocation(advectionProgram, 'wrapHorizontally'), guiControls.wrapHorizontally);

        gl.useProgram(precipitationProgram);
        gl.uniform4f(gl.getUniformLocation(precipitationProgram, 'userInputValues'), posXinSim, mouseYinSim, intensity, guiControls.brushSize * 0.5);
        gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'userInputType'), inputType);
        gl.useProgram(advectionProgram);
      }
      gl.uniform1i(gl.getUniformLocation(advectionProgram, 'userInputType'), inputType);

      if (!leftMousePressed) {
        gl.useProgram(precipitationProgram);
        gl.uniform4f(gl.getUniformLocation(precipitationProgram, 'userInputValues'), -2.0, -2.0, 0.0, 0.0);
        gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'userInputType'), -1);
        gl.useProgram(advectionProgram);
      }
      if (!airplaneMode) {
        gl.useProgram(precipitationProgram);
        gl.uniform2f(gl.getUniformLocation(precipitationProgram, 'airplanePosNorm'), -2.0, -2.0);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'airplaneLightningAttractor'), 0.0);
        gl.useProgram(advectionProgram);
      }
      updateLightningRodUniforms();

      // guiControls.IterPerFrame = 1.0 / timePerIteration * 3600 / 60.0;


      const allowPausedEditStep = guiControls.paused && guiControls.allowEditingWhenPaused && leftMousePressed && inputType > 0;
      if (!guiControls.paused || allowPausedEditStep) { // Simulation part

        let nightAccelerationActive = !airplaneMode && guiControls.dayNightCycle && guiControls.accelerateNight && guiControls.sunAngle < 0.;

        if (guiControls.dayNightCycle && !guiControls.paused) {
          if (airplaneMode) {
            updateSunlight(1.0 / 3600.0 / 60);                                                                    // increase solar time at real speed: 1/60 seconds per frame
          } else {
            updateSunlight(timePerIteration * guiControls.IterPerFrame * (nightAccelerationActive ? 10.0 : 1.0)); // increase solar time
          }
        }

        gl.useProgram(lightingProgram);
        gl.uniform1f(gl.getUniformLocation(lightingProgram, 'IR_rate'), guiControls.IR_rate * (nightAccelerationActive ? 10.0 : 1.0));

        gl.viewport(0, 0, sim_res_x, sim_res_y);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);

        if (!airplaneMode || airplane.hasCrashed() || frameNum % 17 == 0) { // update every 17 frames because 60 * 0.288 secs per iteration = 17.28
          let numIterations = allowPausedEditStep ? 1 : guiControls.IterPerFrame;
          if (airplaneMode)
            numIterations = 1;
          for (var i = 0; i < numIterations; i++) { // Simulation loop
            // calc and apply velocity
            gl.useProgram(velocityProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_0);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, waterTexture_0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.NONE, gl.COLOR_ATTACHMENT2 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // calc curl
            gl.useProgram(curlProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
            gl.bindFramebuffer(gl.FRAMEBUFFER, curlFrameBuff);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // calculate vorticity
            gl.useProgram(vorticityProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, curlTexture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, vortForceFrameBuff);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // apply vorticity, boundary conditions and user input
            if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
            gl.uniform1f(uniformLocation_boundaryProgram_iterNum, iterNum);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, vortForceTexture);
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
            gl.activeTexture(gl.TEXTURE5);
            gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
            gl.activeTexture(gl.TEXTURE6);
            gl.bindTexture(gl.TEXTURE_2D, precipitationDepositionTexture);
            gl.activeTexture(gl.TEXTURE7);
            gl.bindTexture(gl.TEXTURE_2D, lightningDataTexture);

            gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // calc and apply advection
            gl.useProgram(advectionProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, waterTexture_0);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // calc and apply pressure
            gl.useProgram(pressureProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
            gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.NONE, gl.COLOR_ATTACHMENT2 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // calc light
            gl.useProgram(lightingProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
            gl.activeTexture(gl.TEXTURE3);

            if (even) {
              gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
              gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_1);

              srcVAO = precipitationVao_0;
              destTF = precipitationTF_1;
              destVAO = precipitationVao_1;
            } else {
              gl.bindTexture(gl.TEXTURE_2D, lightTexture_1);
              gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);

              srcVAO = precipitationVao_1;
              destTF = precipitationTF_0;
              destVAO = precipitationVao_0;
            }
            even = !even;

            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1 ]); // calc light
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);


            gl.bindFramebuffer(gl.FRAMEBUFFER, precipitationFeedbackFrameBuff);
            gl.clear(gl.COLOR_BUFFER_BIT);         // clear precipitation feedback

            if (guiControls.enablePrecipitation) { // move precipitation, HUGE PERFORMANCE BOTTLENECK!

              gl.useProgram(precipitationProgram);
              gl.uniform1f(uniformLocation_precipitationProgram_iterNum, iterNum);
              gl.enable(gl.BLEND);
              gl.blendFunc(gl.ONE, gl.ONE); // add everything together
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
              gl.activeTexture(gl.TEXTURE2);
              gl.bindTexture(gl.TEXTURE_2D, lightningDataTexture);
              gl.activeTexture(gl.TEXTURE3);
              gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);

              gl.bindVertexArray(srcVAO);
              gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, destTF);
              gl.beginTransformFeedback(gl.POINTS);
              gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1 ]);
              gl.drawArrays(gl.POINTS, 0, NUM_DROPLETS);
              gl.endTransformFeedback();

              // sample to count number of inactive droplets
              if (iterNum % 600 == 0) {
                gl.readBuffer(gl.COLOR_ATTACHMENT0);
                var sampleValues = new Float32Array(4);
                // console.time('cnt');
                gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, sampleValues);
                // console.timeEnd('cnt')         // 1 - 100 ms huge variation
                // console.log(sampleValues[0]);  // number of inactive droplets
                filteredInactiveDroplets = (filteredInactiveDroplets == 0.0) ? sampleValues[0] : mixGeneric(filteredInactiveDroplets, sampleValues[0], 0.32);
                guiControls.inactiveDroplets = filteredInactiveDroplets;
                // gl.useProgram(precipitationProgram); // already set
                gl.uniform1f(uniformLocation_precipitationProgram_inactiveDroplets, filteredInactiveDroplets);
              }

              gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
              gl.disable(gl.BLEND);
              gl.bindVertexArray(fluidVao); // set screenfilling rect again


              // Extract lightningLocation from precipitationfeedback
              gl.useProgram(lightningLocationProgram);
              gl.uniform1f(uniformLocation_lightningLocationProgram_iterNum, iterNum);

              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);

              gl.bindFramebuffer(gl.FRAMEBUFFER, lightningDataFrameBuff);
              gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

              gl.readBuffer(gl.COLOR_ATTACHMENT0);
              var lightningDataValues = new Float32Array(4);
              gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, lightningDataValues);
              // console.log('lightningDataValues: ', lightningDataValues[0], lightningDataValues[1], lightningDataValues[2], iterNum, lightningDataValues[3]);

              if (Math.round(lightningDataValues[2]) == iterNum) {
                const lightningIntensity = Math.pow(lightningDataValues[3], 2.0);

                triggerLightningEffects(lightningDataValues[0], lightningDataValues[1], lightningIntensity);

                if (guiControls.sound)
                  soundSystem.soundThunder(lightningDataValues[0], lightningDataValues[1], lightningIntensity);
              }
            }

            if (displayWeatherStations && iterNum % 208 == 0) { // ~every 60 in game seconds:  0.00008 *3600 * 208 = 59.9
              for (i = 0; i < weatherStations.length; i++) {
                weatherStations[i].measure();
              }
              for (i = weatherBalloons.length - 1; i >= 0; i--) {
                weatherBalloons[i].measure();
                if (weatherBalloons[i].destroyed)
                  weatherBalloons.splice(i, 1);
              }
            }
            if (!airplaneMode) {
              iterNum++;
            }
          }
        }

        if (airplaneMode) {
          iterNum++; // make sure iterNum increases every frame for nice lightning
          airplane.takeUserInput();
          airplane.move();
        }

      } // end of simulation part

      if (guiControls.showGraph) {
        soundingGraph.draw(Math.floor(Math.abs(mod(mouseXinSim * sim_res_x, sim_res_x))), Math.floor(mouseYinSim * sim_res_y));
      }

    } // END OF NOT SETUP MODE


    let cursorType = 1.0; // normal circular brush
    if (guiControls.wholeWidth) {
      cursorType = 2.0;   // cursor whole width brush
    } else if (SETUP_MODE || (inputType <= 0 && !bPressed && (guiControls.tool == 'TOOL_NONE' || guiControls.tool == 'TOOL_STATION' || guiControls.tool == 'TOOL_BALLOON' || guiControls.tool == 'TOOL_LIGHTNING_ROD'))) {
      cursorType = 0;     // cursor off sig
    }

    gl.useProgram(postProcessingProgram);

    if (cursorType != 0 && !sunIsUp) {
      // working at night
      gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), 2.0);
    } else {
      gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), guiControls.exposure);
    }
    gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'motionBlurStrength'), clamp(guiControls.lightningMotionBlur + lightningShakeHFAmplitude * 18.0, 0.0, 1.0));

    if (inputType == 0) {
      // clicking while tool is set to flashlight(NONE)
      // enable flashlight
      cursorType += 0.55;
    }

    // Follow droplet
    if (dropletFollowID >= 0) {
      let dropletInfo = readDropletData(dropletFollowID);
      cam.setPosition(-dropletInfo[0] * 2.0 + 1.0, -dropletInfo[1] * 2.0 * (sim_res_y / sim_res_x) + (sim_res_y / sim_res_x));

      let dropletInfoCanvas = getEl('dropletInfoCanvas');
      if (!dropletInfoCanvas)
        return;
      let ctx = dropletInfoCanvas.getContext('2d');

      ctx.clearRect(0, 0, dropletInfoCanvas.width, dropletInfoCanvas.height);
      ctx.fillStyle = '#00000055';
      ctx.fillRect(0, 0, dropletInfoCanvas.width, dropletInfoCanvas.height);

      ctx.fillStyle = '#FF0000';
      ctx.fillRect(0, 0, 2, 2);

      ctx.font = '15px Arial';
      ctx.fillStyle = '#00AAFF';
      ctx.fillText('Water: ' + dropletInfo[2].toFixed(2), 0, 15);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('Ice     : ' + dropletInfo[3].toFixed(2), 0, 30);
      ctx.fillStyle = '#00FF00';
      ctx.fillText('Dens : ' + dropletInfo[4].toFixed(2), 0, 45);
    }

    if (airplaneMode) {
      airplane.display();
    }

    // render to canvas
    gl.useProgram(realisticDisplayProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // null is canvas
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);        // background color
    gl.clear(gl.COLOR_BUFFER_BIT);


    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);

    guiControls.displayMode = sanitizeDisplayMode(guiControls.displayMode);
    if (guiControls.displayMode == 'DISP_REAL') {

      { //  Abient Light Calculation
        gl.bindVertexArray(postProcessingVao);

        gl.bindFramebuffer(gl.FRAMEBUFFER, ambientLightFBOs[0].frameBuffer);
        gl.viewport(0, 0, ambientLightFBOs[0].width, ambientLightFBOs[0].height);
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        let prevFBO = emittedLightFBO; // the previous FBO

        gl.useProgram(bloomBlurProgram);
        gl.uniform1i(gl.getUniformLocation(bloomBlurProgram, 'bloomTexture'), 0);

        for (let blurTimes = 0; blurTimes < 2; blurTimes++) { // blur twice for smoother result

          // downsample
          for (let i = 1; i < ambientLightFBOs.length; i++) {
            let destFBO = ambientLightFBOs[i];
            gl.uniform2f(gl.getUniformLocation(bloomBlurProgram, 'texelSize'), prevFBO.texelSizeX, prevFBO.texelSizeY);

            gl.viewport(0, 0, destFBO.width, destFBO.height);

            // bind texture
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, prevFBO.texture);

            gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO.frameBuffer);
            // gl.drawBuffers([ gl.BACK ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to destFBO

            prevFBO = destFBO;
          }

          // upsample and add
          gl.blendFunc(gl.ONE, gl.ONE); // add to the existing texture in the framebuffer
          gl.enable(gl.BLEND);

          for (let i = ambientLightFBOs.length - 2; i >= 0; i--) {
            let destFBO = ambientLightFBOs[i];

            gl.uniform2f(gl.getUniformLocation(bloomBlurProgram, 'texelSize'), prevFBO.texelSizeX, prevFBO.texelSizeY);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, prevFBO.texture);

            gl.viewport(0, 0, destFBO.width, destFBO.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO.frameBuffer);
            // gl.drawBuffers([ gl.BACK ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to destFBO

            prevFBO = destFBO;
          }
          gl.disable(gl.BLEND);
        }
        gl.bindVertexArray(fluidVao);
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);


      gl.bindFramebuffer(gl.FRAMEBUFFER, hdrFBO.frameBuffer); // render to hdr framebuffer
      // gl.viewport(0, 0, sim_res_x, sim_res_y);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.0, 0.0, 0.0, 1.0); // background color
      gl.clear(gl.COLOR_BUFFER_BIT);


      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, surfaceTextureMap);
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, curlTexture);
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);


      updateLightningShakePhysics();

      const shakenViewX = cam.curXpos + lightningShakeOffsetX + lightningShakeHFOffsetX;
      const shakenViewY = cam.curYpos + lightningShakeOffsetY + lightningShakeHFOffsetY;

      // draw background
      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, airplane.directionIsLeft ? A380Texture : A380_R_Texture); // A380Texture
      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D, ambientLightFBOs[0].texture);
      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, A380GearTexture);

      gl.useProgram(skyBackgroundDisplayProgram);
      gl.uniform2f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
      gl.uniform3f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'view'), shakenViewX, shakenViewY, cam.curZoom);
      gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'Xmult'), horizontalDisplayMult);
      gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'iterNum'), iterNum);

      gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to hdrFramebuffer

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);


      // draw clouds and terrain
      if (guiControls.paused && !lightningWasPaused) {
        lightningPauseStartFrame = frameNum;
        lightningPauseStartIter = iterNum;
        lightningWasPaused = true;
      } else if (!guiControls.paused && lightningWasPaused) {
        lightningWasPaused = false;
      }

      const lightningAnimIter = guiControls.paused
        ? lightningPauseStartIter + (frameNum - lightningPauseStartFrame)
        : iterNum;

      gl.useProgram(realisticDisplayProgram);
      gl.uniform2f(gl.getUniformLocation(realisticDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
      gl.uniform3f(gl.getUniformLocation(realisticDisplayProgram, 'view'), shakenViewX, shakenViewY, cam.curZoom);
      gl.uniform4f(gl.getUniformLocation(realisticDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'Xmult'), horizontalDisplayMult);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'iterNum'), iterNum);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningAnimIter'), lightningAnimIter);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'lightningColorTempMult'), guiControls.lightningColorTempMult);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'electricFieldVizStrength'), guiControls.electricFieldVizStrength);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'dynamicChargeSeparation'), guiControls.dynamicChargeSeparation);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'electricFieldDiffusion'), guiControls.electricFieldDiffusion);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'mobileLightningVisibility'), getMobileLightningVisibility());
    gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'showLightningRods'), guiControls.showLightningRods ? 1 : 0);

      // Don't display vectors when zoomed out because you would just see noise
      if (cam.curZoom / sim_res_x > 0.003) {
        gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'displayVectorField'), displayVectorField);
      } else {
        gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'displayVectorField'), 0.0);
      }


      let lightningTexNum = Math.floor(lightningAnimIter / 400) % numLightningTextures;
      // console.log(lightningTexNum)

      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, lightningTextures[lightningTexNum]);
      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, lightningDataTexture);

      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D, ambientLightFBOs[0].texture);


      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to hdr framebuffer

      gl.disable(gl.BLEND);

      // Post processing:

      gl.bindVertexArray(postProcessingVao);


      gl.useProgram(isolateBrightPartsProgram);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, hdrFBO.texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBOs[0].frameBuffer); // brightPartsFrameBuffer
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.0, 0.0, 0.0, 1.0);                            // background color
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // render bright parts to seperate texture


      // BLOOM

      let prevFBO = bloomFBOs[0]; // the previous FBO

      gl.useProgram(bloomBlurProgram);
      gl.uniform1i(gl.getUniformLocation(bloomBlurProgram, 'bloomTexture'), 0);


      // downsample
      for (let i = 1; i < bloomFBOs.length; i++) {
        let destFBO = bloomFBOs[i];
        gl.uniform2f(gl.getUniformLocation(bloomBlurProgram, 'texelSize'), prevFBO.texelSizeX, prevFBO.texelSizeY);

        gl.viewport(0, 0, destFBO.width, destFBO.height);

        // bind texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, prevFBO.texture);

        gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO.frameBuffer);
        // gl.drawBuffers([ gl.BACK ]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to destFBO

        prevFBO = destFBO;
      }

      // upsample and add
      gl.blendFunc(gl.ONE, gl.ONE); // add to the existing texture in the framebuffer
      gl.enable(gl.BLEND);

      for (let i = bloomFBOs.length - 2; i >= 0; i--) {
        let destFBO = bloomFBOs[i];

        gl.uniform2f(gl.getUniformLocation(bloomBlurProgram, 'texelSize'), prevFBO.texelSizeX, prevFBO.texelSizeY);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, prevFBO.texture);

        gl.viewport(0, 0, destFBO.width, destFBO.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO.frameBuffer);
        // gl.drawBuffers([ gl.BACK ]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to destFBO

        prevFBO = destFBO;
      }

      gl.disable(gl.BLEND);

      gl.useProgram(postProcessingProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, hdrFBO.texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bloomFBOs[0].texture);

      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      if (SETUP_MODE) {
        gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), 50.0);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null); // null is canvas
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.0, 0.0, 0.0, 1.0);        // background color
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.drawBuffers([ gl.BACK ]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to canvas

      gl.bindVertexArray(fluidVao);

      if (guiControls.showDrops) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        // draw drops over clouds
        // draw precipitation
        gl.useProgram(precipDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(precipDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(precipDisplayProgram, 'view'), shakenViewX, shakenViewY, cam.curZoom);
        gl.bindVertexArray(destVAO);
        gl.drawArrays(gl.POINTS, 0, NUM_DROPLETS);
        gl.bindVertexArray(fluidVao); // set screenfilling rect again
        gl.disable(gl.BLEND);
      }


    } else {
      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D, colorScalesTexture);

      if (guiControls.displayMode == 'DISP_TEMPERATURE') {
        gl.useProgram(temperatureDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(temperatureDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(temperatureDisplayProgram, 'view'), shakenViewX, shakenViewY, cam.curZoom);
        gl.uniform4f(gl.getUniformLocation(temperatureDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1f(gl.getUniformLocation(temperatureDisplayProgram, 'Xmult'), horizontalDisplayMult);


        // Don't display vectors when zoomed out because you would just see
        // noise
        if (cam.curZoom / sim_res_x > 0.003) {
          gl.uniform1f(gl.getUniformLocation(temperatureDisplayProgram, 'displayVectorField'), displayVectorField);
        } else {
          gl.uniform1f(gl.getUniformLocation(temperatureDisplayProgram, 'displayVectorField'), 0.0);
        }

      } else if (guiControls.displayMode == 'DISP_AIRQUALITY') {
        gl.useProgram(airQualityDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(airQualityDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(airQualityDisplayProgram, 'view'), shakenViewX, shakenViewY, cam.curZoom);
        gl.uniform4f(gl.getUniformLocation(airQualityDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1f(gl.getUniformLocation(airQualityDisplayProgram, 'Xmult'), horizontalDisplayMult);

      } else if (guiControls.displayMode == 'DISP_IRDOWNTEMP') {
        gl.useProgram(IRtempDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(IRtempDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(IRtempDisplayProgram, 'view'), shakenViewX, shakenViewY, cam.curZoom);
        gl.uniform4f(gl.getUniformLocation(IRtempDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1i(gl.getUniformLocation(IRtempDisplayProgram, 'upOrDown'), 0);
        gl.uniform1f(gl.getUniformLocation(IRtempDisplayProgram, 'Xmult'), horizontalDisplayMult);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
      } else if (guiControls.displayMode == 'DISP_IRUPTEMP') {
        gl.useProgram(IRtempDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(IRtempDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(IRtempDisplayProgram, 'view'), shakenViewX, shakenViewY, cam.curZoom);
        gl.uniform4f(gl.getUniformLocation(IRtempDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1i(gl.getUniformLocation(IRtempDisplayProgram, 'upOrDown'), 1);
        gl.uniform1f(gl.getUniformLocation(IRtempDisplayProgram, 'Xmult'), horizontalDisplayMult);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
      } else {
        gl.useProgram(universalDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(universalDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(universalDisplayProgram, 'view'), shakenViewX, shakenViewY, cam.curZoom);
        gl.uniform4f(gl.getUniformLocation(universalDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'Xmult'), horizontalDisplayMult);

        switch (guiControls.displayMode) {
        case 'DISP_HORIVEL':
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 0);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 10.0); // 20.0
          break;
        case 'DISP_VERTVEL':
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 1);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 10.0); // 20.0
          break;
        case 'DISP_WATER':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 0);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), -0.06); // negative number so positive amount is blue
          break;
        case 'DISP_IRHEATING':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 1);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 50000.0);
          break;
        case 'DISP_PRECIPFEEDBACK_MASS':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 0);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 0.3);
          break;
        case 'DISP_PRECIPFEEDBACK_HEAT':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 1);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 500.0);
          break;
        case 'DISP_PRECIPFEEDBACK_VAPOR':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 2);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 500.0);
          break;
        case 'DISP_PRECIPFEEDBACK_RAIN':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, precipitationDepositionTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 0);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 1.0);
          break;
        case 'DISP_PRECIPFEEDBACK_SNOW':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, precipitationDepositionTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 1);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 1.0);
          break;
        case 'DISP_SOIL_MOISTURE':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, waterTexture_0);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 2);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 0.02);
          break;
        case 'DISP_RADAR':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 2);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 1.85);
          break;
        case 'DISP_CURL':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, curlTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 0);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 7.0);
          break;
        }
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to canvas
    }

    if (displayWeatherStations) {
      for (i = 0; i < weatherStations.length; i++) {
        weatherStations[i].updateCanvas(); // update weather stations
      }
      updateTornadoLabel();
      if (guiControls.showWeatherBalloons) {
        for (i = 0; i < weatherBalloons.length; i++) {
          weatherBalloons[i].updateCanvas();
        }
      }
    }

    ensureMobileFlightControls();

    frameNum++;
    requestAnimationFrame(draw);
  }

  //////////////////////////////////////////////////////// functions:

  function hideOrShowGraph()
  {
    if (!soundingGraph.graphCanvas)
      return;
    if (guiControls.showGraph) {
      soundingGraph.graphCanvas.style.display = 'block';
    } else {
      soundingGraph.graphCanvas.style.display = 'none';
    }
  }

  function pad(num, size)
  {
    num = num.toString();
    while (num.length < size)
      num = '0' + num;
    return num;
  }

  function dateTimeStr()
  {
    var timeStr;
    if (guiControls.twelveHourClock) { // 12 hour clock for Americans
      timeStr = simDateTime.toLocaleString('en-US', {hour12 : true, hour : 'numeric', minute : 'numeric'});
    } else {                           // 24 hour clock
      timeStr = simDateTime.toLocaleString('nl-NL', {hour12 : false, hour : 'numeric', minute : 'numeric'});
    }

    const monthStr = simDateTime.toLocaleString('en-us', {month : 'short', day : 'numeric'});
    return timeStr + '&nbsp; ' + monthStr;
  }

  function onUpdateTimeOfDaySlider()
  {
    if (!simDateTime)
      simDateTime = new Date();
    let minutes = (guiControls.timeOfDay % 1) * 60;
    simDateTime.setHours(guiControls.timeOfDay, minutes);
    updateSunlight();
  }

  function onUpdateMonthSlider()
  {
    if (!simDateTime)
      simDateTime = new Date();
    let month = guiControls.month - 0.96;
    let date = (month % 1) * 30;
    simDateTime.setMonth(month, date);
    updateSunlight();
  }

  function updateSunlight(deltaT_hours)
  {
    if (!simDateTime)
      simDateTime = new Date();
    if (deltaT_hours != 'MANUAL_ANGLE') {
      if (deltaT_hours != null) {                                                   // increment time
        simDateTime = new Date(simDateTime.getTime() + deltaT_hours * 3600 * 1000); // convert hours to ms and add to current date
        guiControls.timeOfDay = simDateTime.getHours() + simDateTime.getMinutes() / 60. + simDateTime.getSeconds() / 3600.;
        guiControls.month = simDateTime.getMonth() + 1 + simDateTime.getDate() / 30.5 + simDateTime.getHours() / 720.;
      } else {
        for (i = 0; i < weatherStations.length; i++) {
          weatherStations[i].clearChart();
        }
      }

      let timeOfDayRad = (guiControls.timeOfDay / 24.0) * 2.0 * Math.PI; // convert to radians

      timeOfDayRad -= Math.PI / 2.0;

      let tiltDeg = Math.sin(guiControls.month * 0.5236 - 1.92) * 23.5; // axis tilt
      let t = tiltDeg * degToRad;                                       // axis tilt in radians
      let l = guiControls.latitude * degToRad;                          // latitude

      guiControls.sunAngle = Math.asin(Math.sin(t) * Math.sin(l) + Math.cos(t) * Math.cos(l) * Math.sin(timeOfDayRad)) * radToDeg;

      if (guiControls.latitude - tiltDeg < 0.0) {
        // If sun is to the north, flip angle
        guiControls.sunAngle = 180.0 - guiControls.sunAngle;
      }
    }
    let solarZenithAngleDeg = (guiControls.sunAngle - 90);
    let solarZenithAngle = solarZenithAngleDeg * degToRad; // Solar zenith angle centered around 0. (0 = vertical)
    // Calculations visualized: https://www.desmos.com/calculator/kzr76zj5hq
    if (Math.abs(solarZenithAngle) < 85.0 * degToRad) {
      sunIsUp = true;
    } else {
      sunIsUp = false;
    }
    //		console.log(solarZenithAngle, sunIsUp);
    //	let sunIntensity = guiControls.sunIntensity *
    // Math.pow(Math.max(Math.sin((90.0 - Math.abs(guiControls.sunAngle)) *
    // degToRad) - 0.1, 0.0) * 1.111, 0.4);
    let solarElevation = Math.max(Math.sin((180.0 - guiControls.sunAngle) * degToRad), 0.0);
    let diurnalLag = clamp(guiControls.diurnalThermalLag, 0.2, 3.0);
    let clearSkyAttenuation = mixGeneric(0.82, 1.22, Math.pow(solarElevation, 0.6 / diurnalLag));
    let seasonalAttenuation = map_range_C(Math.cos((guiControls.month - 6.5) * 0.52), -1.0, 1.0, 0.90, 1.08);
    let sunIntensity = guiControls.sunIntensity * clearSkyAttenuation * seasonalAttenuation * 1250.0;
    // console.log('sunIntensity: ', sunIntensity);

    // minShadowLight = clamp(((90 + 10) - Math.abs(solarZenithAngleDeg)) * 0.006, 0.005, 0.040); // decrease until the sun goes 10 deg below the horizon

    minShadowLight = map_range_C(Math.abs(solarZenithAngleDeg), 100.0, 85.0, 0.005, 0.040); // decrease until the sun goes 10 deg below the horizon

    if (!sunIsUp)
      sunIntensity *= 0.04;

    if (!gl)
      return;

    gl.useProgram(boundaryProgram);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'sunAngle'), solarZenithAngle);
    gl.useProgram(lightingProgram);
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'sunIntensity'), sunIntensity);
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'sunAngle'), solarZenithAngle);
    gl.useProgram(realisticDisplayProgram);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'sunAngle'), solarZenithAngle);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'minShadowLight'), minShadowLight);
    gl.useProgram(skyBackgroundDisplayProgram);
    gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'minShadowLight'), minShadowLight);

    if (guiControls.dayNightCycle && clockEl)
      clockEl.innerHTML = dateTimeStr(); // update clock
    else if (clockEl)
      clockEl.innerHTML = '';
  }


  async function prepareDownload()
  {
    let prevIterPerFrame = guiControls.IterPerFrame;
    var newFileName = prompt('Please enter a file name. Can not include \'.\'', saveFileName);

    if (newFileName != null) {
      if (newFileName != '' && !newFileName.includes('.')) {
        saveFileName = newFileName;

        gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        let baseTextureValues = new Float32Array(4 * sim_res_x * sim_res_y);
        gl.readPixels(0, 0, sim_res_x, sim_res_y, gl.RGBA, gl.FLOAT, baseTextureValues);
        gl.readBuffer(gl.COLOR_ATTACHMENT1);
        let waterTextureValues = new Float32Array(4 * sim_res_x * sim_res_y);
        gl.readPixels(0, 0, sim_res_x, sim_res_y, gl.RGBA, gl.FLOAT, waterTextureValues);
        gl.readBuffer(gl.COLOR_ATTACHMENT2);
        let wallTextureValues = new Int8Array(4 * sim_res_x * sim_res_y);
        gl.readPixels(0, 0, sim_res_x, sim_res_y, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues);

        let precipBufferValues = new ArrayBuffer(rainDrops.length * Float32Array.BYTES_PER_ELEMENT);
        gl.bindBuffer(gl.ARRAY_BUFFER, precipVertexBuffer_0);
        gl.getBufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(precipBufferValues));
        gl.bindBuffer(gl.ARRAY_BUFFER, null); // unbind again


        let weatherStationsPositions = new Int16Array(weatherStations.length * 2);
        for (i = 0; i < weatherStations.length; i++) {
          weatherStationsPositions[i * 2] = weatherStations[i].getXpos();
          weatherStationsPositions[i * 2 + 1] = weatherStations[i].getYpos();
        }


        let strGuiControls = JSON.stringify(guiControls);

        let saveDataArray = [
          Uint16Array.of(sim_res_x), Uint16Array.of(sim_res_y), baseTextureValues, waterTextureValues, wallTextureValues, precipBufferValues, Uint16Array.of(weatherStations.length),
          weatherStationsPositions, strGuiControls
        ];
        let blob = new Blob(saveDataArray);        // combine everything into a single blob
        let arrBuff = await blob.arrayBuffer();    // turn into array for pako
        let arr = new Uint8Array(arrBuff);
        let compressed = window.pako.deflate(arr); // compress
        let compressedBlob = new Blob([ Uint32Array.of(saveFileVersionID), compressed ], {
          type : 'application/x-binary',
        }); // turn back into blob and add version id in front
        download(saveFileName + '.weathersandbox', compressedBlob);
      } else {
        alert('You didn\'t enter a valid file name!');
      }
    }
    guiControls.IterPerFrame = prevIterPerFrame;
    lastSaveTime = new Date(); // reset timer
  }

  function createProgram(vertexShader, fragmentShader, transform_feedback_varyings)
  {
    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);

    if (transform_feedback_varyings != null)
      gl.transformFeedbackVaryings(program, transform_feedback_varyings, gl.INTERLEAVED_ATTRIBS);

    gl.linkProgram(program);
    gl.validateProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return program; // linked succesfully
    } else {
      throw 'ERROR: ' + gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
    }
  }

  async function loadSourceFile(fileName)
  {
    try {
      var request = new XMLHttpRequest();
      request.open('GET', fileName, false);
      request.send(null);
    } catch (error) {
      await loadingBar.showError('ERROR loading shader files! If you just opened index.html, try again using a local server!');
      throw error;
    }

    if (request.status === 200)
      return request.responseText;
    else if (request.status === 404)
      throw 'File not found: ' + fileName;
    else
      throw 'File loading error' + request.status;
  }

  async function loadShader(nameIn)
  {
    const re = /(?:\.([^.]+))?$/;

    let extension = re.exec(nameIn)[1]; // extract file extension

    let shaderType;
    let type;

    if (extension == 'vert') {
      type = 'vertex';
      shaderType = gl.VERTEX_SHADER;
    } else if (extension == 'frag') {
      type = 'fragment';
      shaderType = gl.FRAGMENT_SHADER;
    } else {
      throw 'Invalid shadertype: ' + extension;
    }

    let filename = 'shaders/' + type + '/' + nameIn;

    var shaderSource = await loadSourceFile(filename);
    if (shaderSource.includes('#include "common.glsl"')) {
      shaderSource = shaderSource.replace('#include "common.glsl"', commonSource);
    }

    if (shaderSource.includes('#include "commonDisplay.glsl"')) {
      shaderSource = shaderSource.replace('#include "commonDisplay.glsl"', commonDisplaySource);
    }

    const shader = gl.createShader(shaderType);
    gl.shaderSource(shader, shaderSource);
    // console.time('compileShader');
    gl.compileShader(shader);
    // console.timeEnd('compileShader')

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      // Compile error
      throw filename + ' COMPILATION ' + gl.getShaderInfoLog(shader);
    }
    return new Promise(async (resolve) => {
      await loadingBar.add(3, 'Loading shader: ' + nameIn);
      resolve(shader);
    });
  }

  function adjIterPerFrame(adj) { guiControls.IterPerFrame = Math.round(clamp(guiControls.IterPerFrame + adj, 1, 50)); }

  function isPageHidden() { return document.hidden || document.msHidden || document.webkitHidden || document.mozHidden; }

  function calcFps()
  {
    if (!isPageHidden()) {
      FPS = frameNum - lastFrameNum;
      lastFrameNum = frameNum;


      if (runtimeDeviceInfo) {
        runtimeDeviceInfo.summary = getDeviceInfoSummary();
        runtimeDeviceInfo.resolution = `${window.innerWidth} x ${window.innerHeight}`;
      }

      if (fpsCounterEl) {
        if (guiControls.showFPS) {
          fpsCounterEl.style.display = 'block';
          const frameMs = (1000.0 / Math.max(FPS, 1)).toFixed(1);
          const iterPerSecond = Math.round(FPS * guiControls.IterPerFrame);
          const perfState = FPS >= 58 ? 'STABLE' : (FPS >= 42 ? 'BALANCED' : 'HEAVY');
          fpsCounterEl.textContent = `${FPS} FPS\n${frameMs} ms  |  ${iterPerSecond} it/s\n${perfState}`;
          fpsCounterEl.style.borderColor = FPS >= 58 ? 'rgba(78,224,142,0.6)' : (FPS >= 42 ? 'rgba(255,217,94,0.62)' : 'rgba(255,112,112,0.62)');
        } else {
          fpsCounterEl.style.display = 'none';
        }
      }

      if (!guiControls.paused) {
        console.log(FPS + ' FPS   ' + guiControls.IterPerFrame + ' Iterations / frame      ' + FPS * guiControls.IterPerFrame + ' Iterations / second');

        if (guiControls.auto_IterPerFrame && !airplaneMode) {
          const fpsTarget = 60;
          adjIterPerFrame((FPS / fpsTarget - 1.0) * 5.0); // example: ((30 / 60)-1.0) = -0.5

          if (FPS == fpsTarget)
            adjIterPerFrame(1);
        }
      }
      // calculate total amounts of water and smoke for verification of fluid simulation
      /*
            gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
            gl.readBuffer(gl.COLOR_ATTACHMENT1); // watertexture
            var waterTextureValues = new Float32Array(sim_res_x * sim_res_y * 4);
            gl.readPixels(0, 0, sim_res_x, sim_res_y, gl.RGBA, gl.FLOAT, waterTextureValues);

            let totalWaterVapor = 0.0;
            let totalCloudWater = 0.0;
            let totalSmoke = 0.0;

            for (let x = 0; x < sim_res_x; x++) {
              for (let y = 0; y < sim_res_y; y++) {
                let cellInd = (x + y * sim_res_x) * 4;
                let vapor = waterTextureValues[cellInd + 0];
                if (vapor < 1000.0) { // ignore wall
                  totalCloudWater += waterTextureValues[cellInd + 1];
                  totalWaterVapor += vapor;

                  totalSmoke += waterTextureValues[cellInd + 3];
                }
              }
            }

            let totalWater = totalWaterVapor + totalCloudWater;
            console.log('Water  Vapor  Cloud  Smoke\n', Math.round(totalWater), Math.round(totalWaterVapor), Math.round(totalCloudWater), Math.round(totalSmoke));
            */
    }
  }
} // end of mainscript
