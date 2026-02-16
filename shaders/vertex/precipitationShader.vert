#version 300 es
precision highp float;


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

uniform vec2 resolution;
uniform vec2 texelSize;
uniform float dryLapse;

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
uniform float precipitationEffectMult;
uniform float lightningGroundBias;
uniform float snowDensity;        // 0.2 - 0.5
uniform float fallSpeed;          // 0.0003
uniform float growthRate0C;       // 0.0005
uniform float growthRate_30C;     // 0.01
uniform float freezingRate;       // 0.0002
uniform float meltingRate;        // 0.0015
uniform float evapRate;           // 0.0005

#include "common.glsl"

vec2 newPos;
vec2 newMass;
float newDensity;

bool isActive = true;
bool spawned = false; // spawned in this iteration
bool lightningSpawned = false;

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

  if (mass[WATER] < 0.) { // inactive
    // Reworked spawn system:
    // - seed from gl_VertexID to avoid state-collapse patterns (mobile precision friendly)
    // - adaptive spawn limiter from active/inactive ratio
    // - cloud/instability driven spawn mass and lightning generation

    float dropID = float(gl_VertexID) + 1.0;
    vec2 spawnSeed = vec2(dropID * 0.754877 + iterNum * 0.013,
                          dropID * 0.569840 - iterNum * 0.017);
    texCoord = vec2(random2d(spawnSeed), random2d(spawnSeed.yx + 13.37));
    texCoord = clamp(texCoord, texelSize * 2.0, vec2(1.0) - texelSize * 2.0);

    // sample fluid at generated position
    base = texture(baseTex, texCoord);
    water = texture(waterTex, texCoord);

    // check if position is okay to spawn
    realTemp = potentialToRealT(base[TEMPERATURE]); // in Kelvin

    const float nominalSpawnMass = 0.12;
    float threshold = realTemp > CtoK(0.0) ? aboveZeroThreshold : subZeroThreshold;

    float cloudExcess = max(water[CLOUD] - threshold, 0.0);
    float instability = map_rangeC(-base[PRESSURE], -0.05, 0.15, 0.6, 1.35);
    float baseSpawnMass = clamp((nominalSpawnMass + cloudExcess * 0.07) * instability, 0.05, 0.34);

    if (water[CLOUD] > threshold && base[TEMPERATURE] < 2500.0) {
      float inactiveFrac = clamp(inactiveDroplets / max(numDroplets, 1.0), 0.0, 1.0);
      float activeFrac = 1.0 - inactiveFrac;
      float spawnLimiter = mix(1.25, 0.45, activeFrac);

      float moistureSupport = map_rangeC(water[TOTAL], 2.0, 24.0, 0.35, 1.25);
      float orographicBoost = map_rangeC(abs(base[VY]), 0.0, 0.020, 0.9, 1.45);
      float spawnChance = cloudExcess * spawnChanceMult * resolution.x * resolution.y;
      spawnChance /= (inactiveDroplets * spawnLimiter + 24.0);
      spawnChance *= map_rangeC(cloudExcess, 0.0, 2.8, 0.35, 1.8) * moistureSupport * orographicBoost * precipitationEffectMult;
      float spawnFloor = clamp(1.0 / max(numDroplets, 1.0), 0.000001, 0.0015) * precipitationEffectMult;
      spawnChance = clamp(spawnChance, spawnFloor, 0.92);

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

          float cloudPlusPrecipDensity = water[CLOUD] + water[PRECIPITATION] * 1.25;
          float graupelNegativeCharge = mixedPhaseFactor * (0.55 + downdraftFactor) * map_rangeC(newDensity, snowDensity, 1.3, 0.25, 1.45);
          float icePositiveCharge = mixedPhaseFactor * updraftFactor * map_rangeC(1.0 - min(newDensity, 1.0), 0.0, 1.0, 0.2, 1.4);

          float chargeDipole = max(graupelNegativeCharge + icePositiveCharge - abs(graupelNegativeCharge - icePositiveCharge) * 0.35, 0.0);
          float pressureFactor = map_rangeC(base[PRESSURE], -0.06, 0.12, 0.82, 1.35);
          float electricPotential = chargeDipole * pressureFactor * map_rangeC(base[VY], -0.01, 0.02, 0.6, 1.25);

          float lightningSpawnChance = max(cloudPlusPrecipDensity - lightningCloudDensityThreshold, 0.0) * lightningChanceMult;
          lightningSpawnChance *= (0.18 + electricPotential * 1.9);
          lightningSpawnChance *= map_rangeC(lightningMinInterval, 0.0, 80.0, 1.0, 0.50);

          float icWeight = max(icLightningRatio, 0.0);
          float ctgWeight = max(ctgLightningRatio, 0.0);
          float modeNorm = max(icWeight + ctgWeight, 0.001);
          float icProb = icWeight / modeNorm;
          float cloudBaseFactor = map_rangeC(texCoord.y, 0.10, 0.65, 1.30, 0.70);
          float cgBoost = map_rangeC((ctgWeight / modeNorm) * lightningGroundBias * cloudBaseFactor, 0.0, 2.0, 1.0, 1.55);
          lightningSpawnChance *= cgBoost;
          lightningSpawnChance = clamp(lightningSpawnChance, 0.0, 0.34);

          float strikeRand = random2d(spawnSeed * 0.73 + vec2(base[TEMPERATURE] * 0.003, water[TOTAL] * 0.121));
          if (lightningData[START_ITERNUM] < iterNum - lightningMinInterval && strikeRand < lightningSpawnChance) {
            lightningSpawned = true;
            isActive = false;
            gl_PointSize = 1.0;

            bool isIC = random2d(spawnSeed * 1.93 + vec2(iterNum * 0.0013, cloudPlusPrecipDensity)) < icProb;
            float icYOffset = map_rangeC(random2d(spawnSeed * 2.67 + vec2(3.0)), 0.0, 1.0, 0.04, 0.24);
            feedback.xy = vec2(texCoord.x, isIC ? min(texCoord.y + icYOffset, 0.96) : texCoord.y);
            feedback[START_ITERNUM] = iterNum;

            float flashIntensity = cloudPlusPrecipDensity * 0.24 + electricPotential * 1.55 + random2d(texCoord * 31.7) * 0.30;
            flashIntensity *= map_rangeC(lightningFlashRate, 0.3, 3.0, 0.75, 1.45);
            flashIntensity = clamp(flashIntensity, 0.08, 5.4);
            feedback[INTENSITY] = isIC ? -flashIntensity * 0.8 : flashIntensity;
            gl_Position = vec4(vec2(-1.0 + texelSize.x * 3.0, -1.0 + texelSize.y), 0.0, 1.0);
          }
        } else {
          newMass[WATER] = baseSpawnMass;
          newMass[ICE] = 0.0;
          newDensity = 1.0;
          feedback[MASS] += newMass[WATER] * (0.05 * precipitationEffectMult);
        }

        feedback[VAPOR] -= baseSpawnMass;
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

      float growth = water[CLOUD] * growthRate * surfaceArea;

      // Hail growth enhancement:
      if (realTemp < CtoK(0.0) && water[CLOUD] > 0.0 && newDensity >= 1.0) { // below freezing
        growth += surfaceArea * water[PRECIPITATION] * 0.0030;            // rain freezing onto hail
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

      float evapAndSubli = max((maxWater(dropletTemp) - water[TOTAL]) * surfaceArea * evapRate, 0.); // 0.0005 evaporation and sublimation only positive

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

      // Update position
      // move with air    * 2. because droplet position goes from -1. to 1
      newPos += base.xy / resolution * 2.;
      newPos.y -= fallSpeed * newDensity * sqrt(totalMass / surfaceArea); // fall speed relative to air
      /*
       // falling at fixed speed:
      float cellHeight = texelSize.y * 12000.0; // in meters
      float realSecPerIter = 0.288;
      float metersPerSec = 6.0;
      float cellsPerSec = metersPerSec / cellHeight;
      float cellsPerIter = cellsPerSec * realSecPerIter;
      newPos.y -= cellsPerIter * 2. * texelSize.y;
      */

      newPos.x = mod(newPos.x + 1., 2.) - 1.; // wrap horizontal position around map edges

      feedback[MASS] = totalMass;

    }               // update

#define pntSize 12. // 16.
    const float pntSurface = pntSize * pntSize;
    // devide by suface area to keep total amount constant
    feedback[MASS] /= pntSurface;
    feedback[HEAT] /= pntSurface;
    feedback[VAPOR] /= pntSurface;

    deposition[RAIN_DEPOSITION] /= pntSize; // only width matters because it's only applied at surface layer
    deposition[SNOW_DEPOSITION] /= pntSize; // only width matters because it's only applied at surface layer

    gl_PointSize = pntSize;

    gl_Position = vec4(newPos, 0.0, 1.0);
  } // active

  position_out = newPos;
  mass_out = newMass;
  density_out = max(newDensity, 0.);
}
