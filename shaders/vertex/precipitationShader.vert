#version 300 es
precision highp float;
precision highp isampler2D;


in vec2 dropPosition;
in vec2 mass; //[0] water   [1] ice
in float density;

// transform feedback varyings:
out vec2 position_out;
out vec2 mass_out;
out float density_out;

// via fragmentshader to feedback framebuffers for feedback to fluid
out vec4 feedback;
out vec2 deposition; // for rain and snow accumulation on surface

vec2 texCoord;
vec4 water;
vec4 base;
float realTemp;

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform sampler2D lightningDataTex;
uniform isampler2D wallTex;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform float dryLapse;
uniform vec4 userInputValues; // xpos ypos intensity brushSize
uniform int userInputType;

uniform float iterNum;          // used as seed for random function
uniform float numDroplets;      // total number of droplets
uniform float inactiveDroplets; // used to maintain constant spawnrate

uniform float evapHeat;
uniform float meltingHeat;

// prcipitation settings:
uniform float aboveZeroThreshold; // 1.0
uniform float subZeroThreshold;   // 0.0
uniform float spawnChanceMult;    //
uniform float lightningChanceMult;
uniform float lightningMinInterval;
uniform float icLightningRatio;
uniform float ctgLightningRatio;
uniform float lightningFlashRate;
uniform float lightningComplexity;
uniform float multiStrokeLightning;
uniform float precipitationEffectMult;
uniform float lightningGroundBias;
uniform float stormOrganization;
uniform float aerosolLoad;
uniform float entrainmentRate;
uniform float downdraftCoolingMult;
uniform float microburstStrength;
uniform float lightningBranching;
uniform float lightningAnvilDrift;
uniform float precipitationSizeSpectrum;
uniform float hailShatterFactor;
uniform float mobilePrecipBoost;
uniform float mobileLightningVisibility;
uniform float snowDensity;        // 0.2 - 0.5
uniform float fallSpeed;          // 0.0003
uniform float growthRate0C;       // 0.0005
uniform float growthRate_30C;     // 0.01
uniform float freezingRate;       // 0.0002
uniform float meltingRate;        // 0.0015
uniform float evapRate;           // 0.0005
uniform float entrainmentDilution;
uniform float drizzleThresholdShift;
uniform float graupelChargeGain;
uniform float iceCrystalChargeGain;
uniform float stormMoistureLift;
uniform float lightningFrequencyBoost;
uniform float dryLightningAllowance;
uniform float stormPulseStrength;
uniform float lightningRecoveryBoost;
uniform float kesslerAutoconversion;
uniform float ventilationEvapEnhancement;
uniform int lightningRodCount;
uniform vec2 lightningRodPos[8];
uniform float lightningRodRadiusNorm;
uniform vec2 airplanePosNorm;
uniform float airplaneLightningAttractor;
uniform float lightningCloudLinkRadiusNorm;

#include "common.glsl"

vec2 newPos;
vec2 newMass;
float newDensity;

bool isActive = true;
bool spawned = false; // spawned in this iteration
bool lightningSpawned = false;

float wrappedDistX(float a, float b)
{
  float d = abs(a - b);
  return min(d, 1.0 - d);
}

float computeSpawnMass(float cloudWater, float supersat, float instability)
{
  float autoconversion = map_rangeC(kesslerAutoconversion, 0.3, 2.5, 0.60, 1.55);
  float sizeSpectrumMass = map_rangeC(precipitationSizeSpectrum, 0.2, 2.5, 0.72, 1.60);
  float aerosolActivation = map_rangeC(aerosolLoad, 0.1, 2.5, 0.82, 1.30);
  float entrainmentSuppression = map_rangeC(entrainmentRate * entrainmentDilution, 0.2, 3.0, 1.18, 0.64);
  return clamp((0.08 + cloudWater * 0.085 + supersat * 0.052) * instability * autoconversion * sizeSpectrumMass * aerosolActivation * entrainmentSuppression,
               0.03,
               0.55);
}

float computeHydrometeorGrowth(float cloudAccess, float supersat, float growthRate, float surfaceArea)
{
  float cloudAccretion = cloudAccess * map_rangeC(kesslerAutoconversion, 0.3, 2.5, 0.62, 1.65);
  float vaporDeposition = supersat * map_rangeC(precipitationSizeSpectrum, 0.2, 2.5, 0.55, 1.40);
  return max((cloudAccretion + vaporDeposition) * growthRate * surfaceArea, 0.0);
}


// Brand-new precipitation transport model:
// keeps hydrometeors from unrealistically hovering in elevated updraft bands.
float computeSedimentationVelocity(float totalMass, float surfaceArea, float localDensity, float altitudeNorm, float updraft, float downdraft)
{
  float phaseBoost = mix(1.0, 1.55, clamp((localDensity - snowDensity) / max(1.25 - snowDensity, 0.05), 0.0, 1.0));
  float spectrumBoost = map_rangeC(precipitationSizeSpectrum, 0.2, 2.5, 0.88, 1.45);
  float massTerminal = sqrt(max(totalMass / max(surfaceArea, 0.0001), 0.04));
  float baseTerminal = fallSpeed * massTerminal * phaseBoost * spectrumBoost;

  // force a minimum settling component aloft so precip cannot remain suspended indefinitely.
  float altitudeSettlingFloor = fallSpeed * mix(0.42, 0.95, clamp(altitudeNorm, 0.0, 1.0));

  // updrafts can reduce settling but not fully cancel it; downdrafts accelerate fallout.
  float cappedUpdraftAssist = min(max(updraft, 0.0) * 0.28, baseTerminal * 0.68);
  float downdraftAssist = max(downdraft, 0.0) * (0.30 + microburstStrength * 0.25);

  return max(baseTerminal + altitudeSettlingFloor + downdraftAssist - cappedUpdraftAssist, fallSpeed * 0.35);
}

vec2 computeLightningTarget(vec2 sourcePos, vec2 seed, bool isIC, float rodAttraction, float airplaneAttraction, vec2 nearestRod, float ctgWeight)
{
  float anvilShift = (random2d(seed * 5.11 + vec2(iterNum * 0.004)) - 0.5) * texelSize.x * (120.0 + lightningComplexity * 80.0) * lightningAnvilDrift;
  float shiftedX = mod(sourcePos.x + anvilShift + 1.0, 1.0);

  if (isIC) {
    float icYOffset = map_rangeC(random2d(seed * 2.67 + vec2(3.0)), 0.0, 1.0, 0.03, 0.12);
    vec2 icTarget = vec2(shiftedX, clamp(sourcePos.y + icYOffset, 0.26, 0.94));
    icTarget.x = mod(icTarget.x + (random2d(seed * 4.73) - 0.5) * texelSize.x * 140.0 * lightningComplexity + 1.0, 1.0);
    return icTarget;
  }

  float rodTargetX = mix(shiftedX, nearestRod.x, rodAttraction);
  float planeTargetX = mix(shiftedX, airplanePosNorm.x, airplaneAttraction);
  float targetX = mix(rodTargetX, planeTargetX, clamp(airplaneAttraction, 0.0, 1.0));
  float groundTargetY = texelSize.y * (1.5 + random2d(seed * 6.61) * 2.0);
  float targetY = mix(sourcePos.y, groundTargetY, clamp(0.70 + ctgWeight * 0.55, 0.0, 1.0));
  targetY = mix(targetY, nearestRod.y + texelSize.y * 2.0, rodAttraction);
  targetY = mix(targetY, airplanePosNorm.y, clamp(airplaneAttraction * 0.65, 0.0, 1.0));
  vec2 cgTarget = vec2(targetX, clamp(targetY, texelSize.y, 0.98));
  cgTarget.x = mod(cgTarget.x + (random2d(seed * 8.27) - 0.5) * texelSize.x * 18.0 * lightningComplexity + 1.0, 1.0);
  // Keep visible bolt origin in-cloud while still choosing a ground endpoint for physics/selection.
  return vec2(sourcePos.x, max(sourcePos.y, 0.16));
}


void disableDroplet()
{
  newMass[WATER] = -2. - dropPosition.x; // disable droplet by making it negative and save position as seed for respawning
  newMass[ICE] = dropPosition.y;         // save position as seed for random function when respawning later
}

void main()
{
  newPos = dropPosition;
  newMass = mass;         // amount of water and ice carried
  newDensity = density;   // determines fall speed
  feedback = vec4(0.0);
  deposition = vec2(0.0);

  // Artificial Lightning Generator tool: can only trigger from industrial cells and links to nearby cloud within ~100km.
  if (userInputType == 25 && gl_VertexID == 0 && userInputValues.x >= 0.0 && userInputValues.x <= 1.0) {
    float sourceX = userInputValues.x;
    float sourceY = clamp(userInputValues.y, 0.0, 1.0);
    ivec2 sourceCell = ivec2(clamp(int(sourceX * resolution.x), 0, int(resolution.x) - 1), clamp(int(sourceY * resolution.y), 0, int(resolution.y) - 1));
    int sourceWallType = texelFetch(wallTex, sourceCell, 0)[TYPE];

    if (sourceWallType == WALLTYPE_INDUSTRIAL) {
      float bestScore = 0.0;
      vec2 bestCloudPos = vec2(sourceX, sourceY);
      float radius = clamp(lightningCloudLinkRadiusNorm, texelSize.x * 12.0, 0.45);

      for (int sx = -22; sx <= 22; sx++) {
        for (int sy = 1; sy <= 24; sy++) {
          vec2 samplePos = vec2(mod(sourceX + float(sx) * radius / 22.0 + 1.0, 1.0), clamp(sourceY + float(sy) * texelSize.y * 3.2, 0.12, 0.98));
          float cloudSample = texture(waterTex, samplePos)[CLOUD];
          float distX = wrappedDistX(samplePos.x, sourceX);
          float distY = max(samplePos.y - sourceY, 0.0);
          float dist = length(vec2(distX, distY));
          float inRange = smoothstep(radius, 0.0, dist);
          float score = cloudSample * inRange;
          if (score > bestScore) {
            bestScore = score;
            bestCloudPos = samplePos;
          }
        }
      }

      if (bestScore > 0.008) {
        vec4 lightningDataNow = texture(lightningDataTex, vec2(0.5));
        float previousLightningAge = iterNum - lightningDataNow[START_ITERNUM];
        float currentFlashHold = max(lightningMinInterval * map_rangeC(lightningRecoveryBoost, 0.4, 2.0, 1.2, 0.6), 6.0 + abs(lightningDataNow[INTENSITY]) * (2.0 + multiStrokeLightning * 1.5));
        bool lightningChannelFree = lightningDataNow[START_ITERNUM] <= 0.0 || previousLightningAge > currentFlashHold;

        if (lightningChannelFree) {
          float launchStrength = max(bestScore * 5.0 + abs(userInputValues.z) * 0.8, 0.20);
          feedback.xy = vec2(sourceX, clamp(sourceY, 0.02, 0.25));
          feedback[START_ITERNUM] = iterNum;
          feedback[INTENSITY] = launchStrength;
          isActive = false;
          gl_PointSize = 1.0;
          gl_Position = vec4(vec2(-1.0 + texelSize.x * 3.0, -1.0 + texelSize.y), 0.0, 1.0);
          position_out = newPos;
          mass_out = newMass;
          density_out = max(newDensity, 0.);
          return;
        }
      }
    }
  }

  if (mass[WATER] < 0.) { // inactive
    // Reworked spawn system:
    // - seed from gl_VertexID to avoid state-collapse patterns (mobile precision friendly)
    // - adaptive spawn limiter from active/inactive ratio
    // - cloud/instability driven spawn mass and lightning generation

    float dropID = mod(float(gl_VertexID), 65535.0) + 1.0;
    vec2 spawnSeed = vec2(dropID * 0.754877 + iterNum * 0.013,
                          dropID * 0.569840 - iterNum * 0.017);
    texCoord = vec2(random2d(spawnSeed), random2d(spawnSeed.yx + 13.37));
    texCoord = clamp(texCoord, texelSize * 2.0, vec2(1.0) - texelSize * 2.0);

    // sample fluid at generated position
    base = texture(baseTex, texCoord);
    water = texture(waterTex, texCoord);

    // check if position is okay to spawn
    realTemp = potentialToRealT(base[TEMPERATURE]); // in Kelvin

    float threshold = (realTemp > CtoK(0.0) ? aboveZeroThreshold : subZeroThreshold) * drizzleThresholdShift * map_rangeC(kesslerAutoconversion, 0.3, 2.5, 1.22, 0.72);

    float cloudExcess = max(water[CLOUD] - threshold, 0.0);
    float supersat = max(water[TOTAL] - maxWater(realTemp), 0.0);
    float instability = map_rangeC(-base[PRESSURE], -0.05, 0.15, 0.6, 1.35);
    float baseSpawnMass = computeSpawnMass(cloudExcess, supersat, instability);

    if (water[CLOUD] > threshold && base[TEMPERATURE] < 2500.0) {
      float inactiveFrac = clamp(inactiveDroplets / max(numDroplets, 1.0), 0.0, 1.0);
      float activeFrac = 1.0 - inactiveFrac;
      float spawnLimiter = mix(1.25, 0.45, activeFrac);

      float moistureSupport = map_rangeC(water[TOTAL], 2.0, 24.0, 0.35, 1.25);
      float orographicBoost = map_rangeC(abs(base[VY]), 0.0, 0.020, 0.9, 1.45);
      float downdraftEnhancement = map_rangeC(max(-base[VY], 0.0), 0.0, 0.018, 1.0, 1.0 + downdraftCoolingMult * 0.45);
      float spawnChance = cloudExcess * spawnChanceMult * resolution.x * resolution.y;
      spawnChance /= (inactiveDroplets * spawnLimiter + 24.0);
      float organizationBoost = map_rangeC(stormOrganization, 0.2, 2.5, 0.65, 1.9);
      float aerosolSpawnFactor = map_rangeC(aerosolLoad, 0.2, 2.5, 1.15, 0.72);
      float smokeSuppression = map_rangeC(water[SMOKE], 0.0, 0.9, 1.0, 0.12);
      float stormPulse = 1.0 + sin(iterNum * 0.017 + texCoord.x * 14.0 + texCoord.y * 5.0) * 0.25 * stormPulseStrength;
      spawnChance *= map_rangeC(cloudExcess, 0.0, 2.8, 0.45, 2.2) * moistureSupport * orographicBoost * downdraftEnhancement * precipitationEffectMult * organizationBoost * aerosolSpawnFactor * mobilePrecipBoost * smokeSuppression * stormMoistureLift * stormPulse;
      float spawnFloor = clamp(1.0 / max(numDroplets, 1.0), 0.000001, 0.0015) * precipitationEffectMult * mobilePrecipBoost;
      spawnChance = clamp(spawnChance, spawnFloor, 0.96);

      float nrmRand = random2d(spawnSeed * 1.31 + vec2(iterNum * 0.009, -iterNum * 0.007));

      if (spawnChance > nrmRand) { // spawn precipitation particle
        spawned = true;
        newPos = vec2((texCoord.x - 0.5) * 2.0, (texCoord.y - 0.5) * 2.0);

        if (realTemp < CtoK(0.0)) {
          newMass[WATER] = 0.0;
          newMass[ICE] = baseSpawnMass;
          feedback[HEAT] += newMass[ICE] * meltingHeat;

          float mixedPhaseFactor = map_rangeC(realTemp, CtoK(-35.0), CtoK(-5.0), 0.0, 1.0);
          float updraftFactor = map_rangeC(base[VY], 0.0, 0.020, 0.05, 1.8);
          float downdraftFactor = map_rangeC(-base[VY], 0.0, 0.015, 0.0, 1.0);
          float graupelization = clamp((water[PRECIPITATION] * 0.50 + updraftFactor * 0.45) * mixedPhaseFactor, 0.0, 1.0);
          newDensity = mix(snowDensity, 1.22, graupelization);

          vec4 lightningData = texture(lightningDataTex, vec2(0.5));
          const float lightningCloudDensityThreshold = 0.10;

          float cloudPlusPrecipDensity = water[CLOUD] + water[PRECIPITATION] * 1.25 + dryLightningAllowance * 0.12;
          float graupelNegativeCharge = mixedPhaseFactor * (0.55 + downdraftFactor) * map_rangeC(newDensity, snowDensity, 1.3, 0.25, 1.45) * graupelChargeGain;
          float icePositiveCharge = mixedPhaseFactor * updraftFactor * map_rangeC(1.0 - min(newDensity, 1.0), 0.0, 1.0, 0.2, 1.4) * iceCrystalChargeGain;

          float chargeDipole = max(graupelNegativeCharge + icePositiveCharge - abs(graupelNegativeCharge - icePositiveCharge) * 0.35, 0.0);
          float pressureFactor = map_rangeC(base[PRESSURE], -0.06, 0.12, 0.82, 1.35);
          float electricPotential = chargeDipole * pressureFactor * map_rangeC(base[VY], -0.01, 0.02, 0.6, 1.25);

          float lightningSpawnChance = max(cloudPlusPrecipDensity - lightningCloudDensityThreshold, 0.0) * lightningChanceMult;
          lightningSpawnChance *= (0.18 + electricPotential * 1.9);
          lightningSpawnChance *= map_rangeC(lightningMinInterval, 0.0, 80.0, 1.0, 0.50) * map_rangeC(lightningRecoveryBoost, 0.4, 2.0, 0.75, 1.55);
          lightningSpawnChance *= map_rangeC(water[SMOKE], 0.0, 1.2, 1.0, 0.18) * lightningFrequencyBoost;

          float icWeight = max(icLightningRatio, 0.0);
          float ctgWeight = max(ctgLightningRatio, 0.0);
          float modeNorm = max(icWeight + ctgWeight, 0.001);
          float icProb = icWeight / modeNorm;
          float cloudBaseFactor = map_rangeC(texCoord.y, 0.10, 0.65, 1.30, 0.70);
          float cgBoost = map_rangeC((ctgWeight / modeNorm) * lightningGroundBias * cloudBaseFactor, 0.0, 2.0, 1.0, 1.55);
          float organizationElectric = map_rangeC(stormOrganization, 0.2, 2.5, 0.65, 1.8);
          float aerosolElectric = map_rangeC(aerosolLoad, 0.2, 2.5, 0.7, 1.25);
          lightningSpawnChance *= cgBoost * organizationElectric * aerosolElectric;
          lightningSpawnChance *= map_rangeC(lightningBranching * lightningComplexity, 0.2, 4.0, 0.68, 1.95);

          float rodAttraction = 0.0;
          vec2 nearestRod = vec2(0.0);
          for (int r = 0; r < 8; r++) {
            if (r >= lightningRodCount)
              break;
            vec2 rod = lightningRodPos[r];
            float dx = wrappedDistX(texCoord.x, rod.x);
            float dy = max(texCoord.y - rod.y, 0.0);
            float rodDist = length(vec2(dx, dy));
            float influence = smoothstep(lightningRodRadiusNorm, 0.0, rodDist);
            if (influence > rodAttraction) {
              rodAttraction = influence;
              nearestRod = rod;
            }
          }

          lightningSpawnChance *= mix(1.0, 1.8, rodAttraction);

          float planeDx = wrappedDistX(texCoord.x, airplanePosNorm.x);
          float planeDy = max(texCoord.y - airplanePosNorm.y, 0.0);
          float planeDist = length(vec2(planeDx, planeDy));
          float airplaneAttraction = smoothstep(0.30, 0.0, planeDist) * airplaneLightningAttractor;
          lightningSpawnChance *= mix(1.0, 1.55, airplaneAttraction);
          lightningSpawnChance *= map_rangeC(mobileLightningVisibility, 0.8, 2.2, 0.92, 1.28);
          lightningSpawnChance = clamp(lightningSpawnChance, 0.0, 0.88);

          float strikeRand = random2d(spawnSeed * 0.73 + vec2(base[TEMPERATURE] * 0.003, water[TOTAL] * 0.121));
          float previousLightningAge = iterNum - lightningData[START_ITERNUM];
          float currentFlashHold = max(lightningMinInterval * map_rangeC(lightningRecoveryBoost, 0.4, 2.0, 1.25, 0.58), 7.0 + abs(lightningData[INTENSITY]) * (2.8 + multiStrokeLightning * 2.1));
          bool lightningChannelFree = lightningData[START_ITERNUM] <= 0.0 || previousLightningAge > currentFlashHold;
          if (lightningChannelFree && strikeRand < lightningSpawnChance) {
            lightningSpawned = true;
            isActive = false;
            gl_PointSize = 1.0;

            bool forceCG = rodAttraction > 0.04 || airplaneAttraction > 0.06;
            float chargeStratification = map_rangeC(water[CLOUD], threshold * 1.3, threshold * 4.8, 0.0, 1.0);
            bool canBeIC = texCoord.y > 0.26 && water[CLOUD] > threshold * 1.40 && chargeStratification > 0.18;
            float icModeBoost = map_rangeC(chargeStratification * max(base[VY], 0.0), 0.0, 0.04, 1.0, 1.35);
            float icProbability = clamp(icProb * icModeBoost, 0.05, 0.95);
            bool isIC = !forceCG && canBeIC && random2d(spawnSeed * 1.93 + vec2(iterNum * 0.0013, cloudPlusPrecipDensity)) < icProbability;

            feedback.xy = computeLightningTarget(texCoord, spawnSeed, isIC, rodAttraction, airplaneAttraction, nearestRod, ctgWeight);

            feedback[START_ITERNUM] = iterNum;

            float flashIntensity = cloudPlusPrecipDensity * 0.24 + electricPotential * 1.55 + random2d(texCoord * 31.7) * 0.30;
            flashIntensity *= map_rangeC(lightningFlashRate, 0.3, 3.0, 0.75, 1.45);
            flashIntensity *= map_rangeC(stormOrganization * aerosolLoad, 0.04, 6.25, 0.85, 1.35);
            flashIntensity *= map_rangeC(mobileLightningVisibility, 0.8, 2.2, 0.9, 1.35);
            flashIntensity *= mix(1.0, 1.30, rodAttraction);
            float cgGroundBoost = map_rangeC(1.0 - texCoord.y, 0.0, 1.0, 0.9, 1.3);
            float icChannelBoost = map_rangeC(texCoord.y, 0.22, 0.95, 0.95, 1.25);
            flashIntensity *= isIC ? icChannelBoost : cgGroundBoost;
            flashIntensity *= mix(1.0, 1.55, clamp(lightningComplexity - 1.0, 0.0, 1.0));
            flashIntensity = clamp(flashIntensity, 0.08, 8.0);
            feedback[INTENSITY] = isIC ? -flashIntensity * 0.72 : flashIntensity * 1.08;
            gl_Position = vec4(vec2(-1.0 + texelSize.x * 3.0, -1.0 + texelSize.y), 0.0, 1.0);
          }
        } else {
          newMass[WATER] = baseSpawnMass;
          newMass[ICE] = 0.0;
          newDensity = 1.0;
          feedback[MASS] += newMass[WATER] * (0.05 * precipitationEffectMult);
        }

        feedback[VAPOR] -= baseSpawnMass * 1.25;
        feedback[MASS] += baseSpawnMass * 0.08; // immediate cloud-to-precip sink imprint
      }
    }

    if (spawned) {
      if (!lightningSpawned) {
        gl_PointSize = 1.0;
        gl_Position = vec4(newPos, 0.0, 1.0);
      }
    } else { // still inactive
      isActive = false;
      gl_PointSize = 1.0;
      feedback[MASS] = 1.0;                                                     // count 1 inactive droplet
      gl_Position = vec4(vec2(-1.0 + texelSize.x, -1.0 + texelSize.y), 0.0, 1.0); // render to bottom left corner (0, 0)
    }
  }

  if (isActive) {
    if (!spawned) {                               // these values are already set if the droplet just spawned
      texCoord = vec2(dropPosition.x / 2. + 0.5,
                      dropPosition.y / 2. + 0.5); // convert position (-1 to 1) to texture coordinate (0 to 1)
      water = texture(waterTex, texCoord);
      base = texture(baseTex, texCoord);
      realTemp = potentialToRealT(base[TEMPERATURE]); // in Kelvin
    }

    float totalMass = newMass[WATER] + newMass[ICE];

    if (totalMass < 0.04) { // to small
                            // evaporation of residual droplet
      feedback[HEAT] = -(totalMass * evapHeat);
      feedback[VAPOR] = totalMass;

      disableDroplet();

    } else if (newPos.y < -1.0 /* || base[TEMPERATURE] > 500. */ || water[TOTAL] > 1000.) { // water[TOTAL] > 1000.     base[TEMPERATURE] < 500.      to low or wall

      bool hailImpact = newMass[ICE] > 0.06 && newDensity >= 1.0 && newPos.y < -1.0;

      if (hailImpact && random2d(vec2(texCoord.x * 31.7 + iterNum, texCoord.y * 17.3 + mass[ICE])) < 0.50) {
        // hail bounces/scatters instead of directly reusing snow deposition
        deposition[RAIN_DEPOSITION] = newMass[WATER] * 0.35 + newMass[ICE] * 0.18;
        deposition[SNOW_DEPOSITION] = newMass[ICE] * 0.08;

        newMass[WATER] = newMass[WATER] * 0.15 + newMass[ICE] * 0.25;
        newMass[ICE] *= 0.45;
        newDensity = min(max(newDensity, 1.05), 1.35);
        deposition[RAIN_DEPOSITION] += newMass[ICE] * hailShatterFactor * 0.06;

        newPos.y = -1.0 + texelSize.y * (1.5 + random2d(vec2(iterNum, texCoord.x)) * 6.0);
        newPos.x = mod(newPos.x + (random2d(vec2(iterNum * 0.31, texCoord.y)) - 0.5) * texelSize.x * 18.0 + 1.0, 2.0) - 1.0;
      } else {
        if (texture(baseTex, vec2(texCoord.x, texCoord.y + texelSize.y))[TEMPERATURE] > 500.) // if above cell was already wall. because of fast fall speed
          newPos.y += texelSize.y * 1.;                                                       // *2. ? move position up so that the water/snow is correcty added to the ground

        deposition[RAIN_DEPOSITION] = newMass[WATER];                                         // rain accumulation
        deposition[SNOW_DEPOSITION] = newMass[ICE] * (newDensity >= 1.0 ? 0.25 : 1.0);       // hail compacts/splinters, less snowpack gain

        disableDroplet();
      }

    } else { // update droplet

      // float surfaceArea = sqrt(totalMass); // As if droplet is a circle (2D)
      float surfaceArea = pow(totalMass, 1. / 3.); // As if droplet is a sphere (3D)

                                                   // float growthRate = clamp(map_range(realTemp, CtoK(0.0), CtoK(-30.0), growthRate0C, growthRate_30C), growthRate0C, growthRate_30C); // the colder it gets the faster ice forms
      float growthRate = max(map_range(realTemp, CtoK(0.0), CtoK(-30.0), growthRate0C, growthRate_30C), growthRate0C); // the colder it gets the faster ice forms

      // growthRate = 0.0;                                                                                                                  // for debug

      float supersat = max(water[TOTAL] - maxWater(realTemp), 0.0);
      float cloudAccess = max(water[CLOUD], 0.0);
      float growth = computeHydrometeorGrowth(cloudAccess, supersat, growthRate, surfaceArea);

      // Hail growth enhancement:
      if (realTemp < CtoK(0.0) && water[CLOUD] > 0.0 && newDensity >= 1.0) { // below freezing
        growth += surfaceArea * (water[PRECIPITATION] * 0.0030 + supersat * 0.0015);            // rain/supersat accretion onto hail
      }

      feedback[VAPOR] -= growth * 1.0; // takes water from the air


      if (realTemp < CtoK(0.0)) { // below freezing

        newMass[ICE] += growth;   // ice growth
        feedback[HEAT] += growth * meltingHeat;

        float freezing = min((CtoK(0.0) - realTemp) * freezingRate * surfaceArea, newMass[WATER]); // rain freezing
        newMass[WATER] -= freezing;
        newMass[ICE] += freezing;
        feedback[HEAT] += freezing * meltingHeat;

        if (newMass[ICE] > 0.08) {
          float hailGrowthFactor = map_rangeC(water[PRECIPITATION] + max(base[VY], 0.0) * 30.0, 0.0, 1.8, 0.0, 1.0);
          newDensity = min(max(newDensity, 1.0) + hailGrowthFactor * 0.18, 1.35);
        }

      } else {                                                                                                    // above freezing
        newMass[WATER] += growth;                                                                                 // water growth

        float melting = min((realTemp - CtoK(0.0)) * meltingRate * surfaceArea /* / newDensity */, newMass[ICE]); // 0.0002 snow / hail melting
        newMass[ICE] -= melting;
        newMass[WATER] += melting;
        feedback[HEAT] -= melting * meltingHeat;

        newDensity = min(newDensity + (melting / totalMass) * 1.00,
                         1.0); // density increases upto 1.0 as snow melts
      }

      float dropletTemp = potentialToRealT(base[TEMPERATURE]);                                       // should be wetbulb temperature...

      if (newMass[ICE] > 0.0)                                                                        // if any ice
        dropletTemp = min(dropletTemp, CtoK(0.0));                                                   // temp can not be more than 0 C

      float dryDeficit = max((maxWater(dropletTemp) - water[TOTAL]), 0.0);
      float ventFactor = (1.0 + min(length(base.xy) * 30.0, 1.8)) * map_rangeC(ventilationEvapEnhancement, 0.3, 2.5, 0.60, 1.90);
      float evapAndSubli = max(dryDeficit * surfaceArea * evapRate * map_rangeC(newDensity, 0.2, 1.3, 1.0, 0.78) * ventFactor, 0.); // evaporation/sublimation

      // evapAndSubli = 0.0000;                                                                         // remove quickly for DEBUG

      float evap = min(newMass[WATER], evapAndSubli);       // can only evaporate as much water as it contains
      float subli = min(newMass[ICE], evapAndSubli - evap); // the rest is ice sublimation, upto the amount of ice it contains

      newMass[WATER] -= evap;                               // water evaporation
      newMass[ICE] -= subli;                                // ice sublimation

      feedback[VAPOR] += evap;                              // added to water vapor in air
      feedback[VAPOR] += subli;
      feedback[HEAT] -= evap * evapHeat;                    // heat cost extracted from air
      feedback[HEAT] -= subli * evapHeat;
      feedback[HEAT] -= subli * meltingHeat;

      // Brand-new precipitation motion system:
      // horizontal flow still advects drops, but vertical transport prioritizes settling.
      float updraft = max(base[VY], 0.0);
      float downdraft = max(-base[VY], 0.0);
      float altitudeNorm = clamp(texCoord.y, 0.0, 1.0);
      float fallVelocity = computeSedimentationVelocity(totalMass, surfaceArea, newDensity, altitudeNorm, updraft, downdraft);

      // 2D hail dynamics approximation: denser hail keeps momentum, drifts less with air, and can rebound in strong updraft cores.
      float hailFraction = clamp(map_rangeC(newDensity, 0.95, 1.35, 0.0, 1.0), 0.0, 1.0);
      float inertia = mix(1.0, 1.85, hailFraction);
      float drag = mix(1.0, 0.62, hailFraction);
      float lateralTurb = (random2d(newPos * 23.7 + vec2(iterNum * 0.014, -iterNum * 0.011)) - 0.5) * texelSize.x * (0.8 + hailFraction * 1.8);

      float horizontalDrift = map_rangeC(entrainmentRate, 0.2, 3.0, 0.75, 1.2) * drag;
      newPos.x += (base[VX] / resolution.x) * 2.0 * horizontalDrift + lateralTurb;

      float verticalCarry = base[VY] * map_rangeC(newDensity, snowDensity, 1.3, 0.16, 0.06);
      float hailRebound = max(updraft - (0.0025 + hailFraction * 0.0015), 0.0) * 0.24 * hailFraction;
      newPos.y += ((verticalCarry + hailRebound * inertia) / resolution.y) * 2.0;
      newPos.y -= fallVelocity * mix(1.0, 1.38, hailFraction);

      // dry slots rapidly erode suspended hydrometeors and encourage fallout recycling.
      float drySlot = map_rangeC(maxWater(dropletTemp) - water[TOTAL], 0.0, 12.0, 0.0, 1.0);
      if (drySlot > 0.65 && altitudeNorm > 0.35) {
        newMass[WATER] *= 0.96;
        newMass[ICE] *= 0.97;
      }

      newPos.x = mod(newPos.x + 1., 2.) - 1.; // wrap horizontal position around map edges

      feedback[MASS] = totalMass;

    }               // update

    float pointSize = 12.0 * map_rangeC(mobilePrecipBoost, 0.5, 2.5, 0.90, 1.65);
    float pntSurface = pointSize * pointSize;
    // devide by suface area to keep total amount constant
    feedback[MASS] /= pntSurface;
    feedback[HEAT] /= pntSurface;
    feedback[VAPOR] /= pntSurface;

    deposition[RAIN_DEPOSITION] /= pointSize; // only width matters because it's only applied at surface layer
    deposition[SNOW_DEPOSITION] /= pointSize; // only width matters because it's only applied at surface layer

    gl_PointSize = pointSize;

    gl_Position = vec4(newPos, 0.0, 1.0);
  } // active

  position_out = newPos;
  mass_out = newMass;
  density_out = max(newDensity, 0.);
}
