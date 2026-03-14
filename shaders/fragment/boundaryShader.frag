#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;

in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform sampler2D vortForceTex;
uniform isampler2D wallTex;
uniform sampler2D lightTex;
uniform sampler2D precipFeedbackTex;
uniform sampler2D precipDepositionTex;
uniform sampler2D lightningDataTex;
uniform float lightningFireIgnitionBoost;
uniform float shadowCoolingStrength;
uniform float lightningNearbyIgnitionRadiusMult;

uniform float dryLapse;
uniform float evapHeat;
uniform vec2 resolution;
uniform vec2 texelSize;
uniform float vorticity;
uniform float waterEvaporation;
uniform float landEvaporation;
uniform float waterWeight;
uniform vec4 initial_Tv[126];
uniform bool allowCaves;

float getInitialT(int y) { return initial_Tv[y / 4][y % 4]; }

uniform float sunAngle;

uniform float iterNum; // used as seed for random function

uniform float dynamicWaterTemperature;
uniform float precipitationRecycling;
uniform float surfaceRunoffRate;
uniform float soilInfiltrationRate;
uniform float canopyInterception;
uniform float urbanHeatIslandStrength;
uniform float coastalMixing;
uniform float waterAlbedoShift;
uniform float cloudAutoconversionRate;
uniform float cloudLifetimeBoost;

layout(location = 0) out vec4 base;
layout(location = 1) out vec4 water;
layout(location = 2) out ivec4 wall;

#include "common.glsl"

#define minimalFireVegetation 20

#define minimalFireIntensity 0.002

#define wallVerticalInfluence 1 // 2 How many cells above the wall surface effects like heating and evaporation are applied


// #define wallManhattanInfluence 2 // 2 How many cells from the nearest wall effects like smoothing and drag are applied
#define exchangeRate 0.015       // Rate of smoothing near surface

void exchangeWith(vec2 texCoord) // exchange temperature and water
{
  // base[TEMPERATURE] -= (base[TEMPERATURE] - texture(baseTex, texCoord)[TEMPERATURE]) * exchangeRate;
  // water[0] -= (water[0] - texture(waterTex, texCoord)[0]) * exchangeRate;

  base[VX] -= (base[VX] - texture(baseTex, texCoord)[VX]) * exchangeRate;
}


float calcEvaporation(float T, float W, float V, float M)                                             // temperature, total water, vegetation, soil moisture
{
  return max((maxWater(T) - W) * landEvaporation * (V / 127. + 0.1) * min(M + 1.0, 50.0) * 0.05, 0.); // landEvaporation should be adjusted to remove * 0.05 factor
}

float calcFireIntensity(int veg, float moist, float precip) { return max(float(veg) * 0.00025 - moist * 0.00020 - precip * 0.05, 0.); }

void main()
{
  base = texture(baseTex, texCoord);
  water = texture(waterTex, texCoord);

  vec4 precipFeedback = texture(precipFeedbackTex, texCoord);


  float realTemp = potentialToRealT(base[TEMPERATURE]);

  wall = texture(wallTex, texCoord);
  ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
  ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);
  ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);
  ivec4 wallX0Yp = texture(wallTex, texCoordX0Yp);

  vec4 light = texture(lightTex, texCoord);
  vec4 lightningData = texture(lightningDataTex, vec2(0.5));

  bool nextToWall = false;

  wall[VERT_DISTANCE] = wallX0Ym[VERT_DISTANCE] + 1; // height above ground is counted

  if (wall[DISTANCE] != 0) {                         // is fluid, not wall

    wall[TYPE] = wallX0Ym[TYPE];                     // copy wall type from wall below

    if (wall[TYPE] != WALLTYPE_WATER)
      base[TEMPERATURE] += light[NET_HEATING]; // IR heating/cooling effect

    base[TEMPERATURE] += precipFeedback[HEAT]; // rain cools air and riming heats air


    float precipCoalescence = max(-precipFeedback[VAPOR], 0.); // how much cloud water turns into rain
    float precipMassSink = max(precipFeedback[MASS], 0.0);

    float autoConv = clamp(cloudAutoconversionRate, 0.2, 3.0);
    float cloudLife = clamp(cloudLifetimeBoost, 0.4, 3.0);

    // tuned depletion: preserve cloud longevity and avoid runaway cloud collapse from local downpours
    float cloudReservoir = clamp(water[CLOUD] / max(water[TOTAL] + 0.0001, 0.0001), 0.15, 1.0);
    float resilience = 0.82 + clamp(water[CLOUD], 0.0, 2.5) * 0.18;
    float depletionScale = autoConv / max(cloudLife * (0.92 + cloudReservoir * 0.95) * resilience, 0.35);
    water[CLOUD] -= (precipCoalescence * 0.090 + precipMassSink * 0.032) * depletionScale;
    water[TOTAL] -= (precipCoalescence * 0.050 + precipMassSink * 0.014) * depletionScale;

    float precipEvaporation = max(precipFeedback[VAPOR], 0.);

    water[TOTAL] += precipEvaporation; // evaporating rain adds water vapor to air
    water[CLOUD] += precipEvaporation * 0.055 * precipitationRecycling;

    // Anti-runaway cloud limiter: prevent oversized cloud reservoirs from blanketing the whole domain
    // and producing pathological precipitation feedback spikes.
    float heightLimiter = map_rangeC(texCoord.y, 0.0, 1.0, 1.9, 3.8);
    float cloudSoftCap = mix(2.2, 5.2, clamp(cloudLifetimeBoost * 0.45, 0.0, 1.0)) * heightLimiter;
    if (water[CLOUD] > cloudSoftCap) {
      float cloudOverflow = water[CLOUD] - cloudSoftCap;
      float overflowToPrecip = cloudOverflow * map_rangeC(cloudAutoconversionRate, 0.2, 3.0, 0.30, 0.60);
      water[CLOUD] -= cloudOverflow;
      water[PRECIPITATION] += overflowToPrecip * 0.010;
      water[TOTAL] -= cloudOverflow * 0.12;
    }


    //  0.004 for rain visualisation
    water[PRECIPITATION] = max(water[PRECIPITATION] * 0.9972 - 0.000009 + precipFeedback[MASS] * 0.0055 * precipitationRecycling, 0.0);


    // rain removes smoke from air
    water[SMOKE] /= 1. + max(-precipFeedback[VAPOR] * 0.1, 0.0) + precipFeedback[MASS] * 0.000; // rain formation in clouds removes smoke
                                                                                                // quickly , falling rain slower
    water[SMOKE] -= precipFeedback[MASS] * 0.0001;                                              // linearly to remove last little bit


    water[SMOKE] -= max((water[SMOKE] - 4.0) * 0.01, 0.); // dissipate fire color to smoke

    water[SMOKE] = max(water[SMOKE], 0.0);                // snow and smoke can't go below 0


    water[CLOUD] = max(water[CLOUD], 0.0);
    water[TOTAL] = max(water[TOTAL], 0.0);

    if (water[SMOKE] > 4.0) {
      water[SMOKE] -= water[PRECIPITATION] * 0.02; // falling precipitation extinguishes flames
    }

    // GRAVITY
    // temperature is calculated for Vy location
    vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);

#define gravMult 0.0001 // 0.0001 0.0005

    // gravity for convection interpolated between this and above cell to fix wierd waves
    // Because vertical velocity is defined at the top of the cell while temperature is defined in it's center.
    float gravityForce = ((base[TEMPERATURE] + baseX0Yp[TEMPERATURE]) * 0.5 - (getInitialT(int(fragCoord.y)) + getInitialT(int(fragCoord.y) + 1)) * 0.5) * gravMult;

    // float gravityForce = (base[3] - initial_T[int(fragCoord.y)]) * gravMult;

    gravityForce -= water[CLOUD] * gravMult * waterWeight;         // cloud water weight added to gravity force

    gravityForce -= precipFeedback[MASS] * gravMult * waterWeight; // precipitation weigth added to gravity force

    base[VY] += gravityForce;

    // Convective cold-pool outflow proxy from precipitation loading/evaporation.
    float coldPool = max(precipFeedback[MASS] * 18.0 + precipEvaporation * 6.0, 0.0) * precipitationRecycling;
    float coldPoolSpread = clamp(1.0 - texCoord.y * 2.2, 0.0, 1.0);
    float outflowSign = random2d(vec2(fragCoord.y * 0.17 + iterNum * 0.01, fragCoord.x * 0.11)) - 0.5;
    base[VX] += outflowSign * coldPool * 0.00045 * coldPoolSpread;
    base[PRESSURE] += coldPool * 0.00002 * coldPoolSpread;

    // base.x += sin(texCoord.x * PI * 2.0 + iterNum * 0.000005) * (1. - texCoord.y) * 0.00015; // phantom force to simulate high and low pressure areas

    float snowCover = 0.;
    float soilMoisture = 0.;

    if (wallX0Ym[DISTANCE] == 0) { // below is wall
      nextToWall = true;
      wall[DISTANCE] = 1;          // dist to nearest wall = 1

      vec4 waterX0Ym = texture(waterTex, texCoordX0Ym);
      snowCover = waterX0Ym[SNOW];
      soilMoisture = waterX0Ym[SOIL_MOISTURE];
      wall[VERT_DISTANCE] = 1; // directly above ground

      // Local heating system: water-adjacent air warms quicker than land-adjacent air.
      float solarProxy = clamp(cos(sunAngle), 0.0, 1.0);
      float localHeat = solarProxy * 0.000030;
      if (wallX0Ym[TYPE] == WALLTYPE_WATER)
        base[TEMPERATURE] += localHeat * 1.35;
      else
        base[TEMPERATURE] += localHeat * 0.62;
    }

    if (wallXmY0[DISTANCE] == 0) {            // left is wall
      nextToWall = true;
      wall[DISTANCE] = 1;                     // dist to nearest wall = 1

      if (wallXmY0[TYPE] == WALLTYPE_WATER) { // if left is water, build a dyke
        wall[TYPE] = WALLTYPE_LAND;
        wall[DISTANCE] = 0;
      }

      if (wallXpY0[DISTANCE] == 0)            // left and right is wall, make this wall to fill narrow gaps
        wall[DISTANCE] = 0;
    } else if (wallXpY0[DISTANCE] == 0) {     // right is wall
      nextToWall = true;
      wall[DISTANCE] = 1;                     // dist to nearest wall = 1

      if (wallXpY0[TYPE] == WALLTYPE_WATER) { // if right is water, build a dyke
        wall[TYPE] = WALLTYPE_LAND;
        wall[DISTANCE] = 0;
      }
    }
    if (wallX0Yp[DISTANCE] == 0) {                                                  // above is wall
      nextToWall = true;
      if (texCoord.y < 0.99 && (!allowCaves || wallX0Yp[TYPE] == WALLTYPE_WATER)) { // Fill in land below
        wall[TYPE] = WALLTYPE_LAND;
        wall[DISTANCE] = 0;                                                         //  set this to wall
      } else {
        wall[DISTANCE] = 1;
      }
    }


    // if(abs(base.x) > 0.0040 && abs(base.y) > 0.0040){
    //  sample vorticity force
    vec2 vortForceX0Y0 = texture(vortForceTex, texCoord).xy;
    vec2 vortForceXmY0 = texture(vortForceTex, texCoordXmY0).xy;
    vec2 vortForceX0Ym = texture(vortForceTex, texCoordX0Ym).xy;

    float velocityFactor = length(base.xy) * 0.1; // 0.2

    // apply vorticity force
    base.xy += vec2(vortForceX0Y0.x + vortForceX0Ym.x, vortForceX0Y0.y + vortForceXmY0.y) * (vorticity + velocityFactor);
    //}

    if (nextToWall) {
      if (wall[TYPE] != WALLTYPE_WATER) { // any land
        float lightPower = 0.0;

        if (wallX0Ym[DISTANCE] == 0)
          lightPower += max(light[SUNLIGHT] * cos(sunAngle), 0.0); // Light power per horizontal surface area;

        if (wallXmY0[DISTANCE] == 0)
          lightPower += max(light[SUNLIGHT] * sin(sunAngle), 0.0); // Light power on right phasing vertical wall

        if (wallXpY0[DISTANCE] == 0)
          lightPower += max(light[SUNLIGHT] * sin(-sunAngle), 0.0); // Light power on left phasing vertical wall

        float albedoTotal = 1.0;

        if (wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_FIRE) {
          float albedoSoil = map_rangeC(soilMoisture, 0., 20., ALBEDO_DRYSOIL, ALBEDO_WETSOIL);
          albedoSoil = map_rangeC(snowCover, 0.0, fullWhiteSnowHeight, albedoSoil, ALBEDO_SNOW);                         // add snow albedo
          float fullVegetationAlbedo = map_range(snowCover, 0., fullWhiteSnowHeight, ALBEDO_FOREST, ALBEDO_SNOW_FOREST); // the albedo of full tree height with snow taken into account
          albedoTotal = map_range(float(wallX0Ym[VEGETATION]), 0., 127., albedoSoil, fullVegetationAlbedo);
        } else if (wall[TYPE] == WALLTYPE_URBAN) {
          albedoTotal = ALBEDO_URBAN;
        } else if (wall[TYPE] == WALLTYPE_INDUSTRIAL) {
          albedoTotal = ALBEDO_INDUSTRIAL;
        } else if (wall[TYPE] == WALLTYPE_RUNWAY) {
          albedoTotal = ALBEDO_RUNWAY;
        }

        lightPower *= (1. - albedoTotal);
        lightPower *= lightHeatingConst;
        base[TEMPERATURE] += lightPower; // sun heating land
      }
    }

    if (!nextToWall) { // not next to wall

      // find nearest wall
      int nearest = 255;
      // int nearestType = 0; // not used, type is only extended vertically now
      if (wallX0Ym[DISTANCE] < nearest) {
        nearest = wallX0Ym[DISTANCE];
        //   nearestType = wallX0Ym[TYPE];
      }
      if (wallX0Yp[DISTANCE] < nearest) {
        nearest = wallX0Yp[DISTANCE];
        //  nearestType = wallX0Yp[TYPE];
      }
      if (wallXmY0[DISTANCE] < nearest) {
        nearest = wallXmY0[DISTANCE];
        //  nearestType = wallXmY0[TYPE];
      }
      if (wallXpY0[DISTANCE] < nearest) {
        nearest = wallXpY0[DISTANCE];
        //   nearestType = wallXpY0[TYPE];
      }

      wall[DISTANCE] = nearest + 1; // add one to dist to wall
                                    // wall[TYPE] = nearestType;     // type = type of nearest wall
    }

#define surfaceWindSmootingDist 5

    if (wall[VERT_DISTANCE] <= surfaceWindSmootingDist) { // above surface

      if (wall[VERT_DISTANCE] == 1) {
        float surfaceDrag = 0.0015; // water or runway
        if (wall[TYPE] == WALLTYPE_URBAN)
          surfaceDrag = 0.040;
        else if (wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_FIRE)
          surfaceDrag = map_rangeC(float(wall[VEGETATION]), 50., 127., 0.0015, 0.020);

        // base[VX] *= 1. - surfaceDrag;                        // surface drag
        base[VX] -= abs(base[VX]) * base[VX] * surfaceDrag * 50.; // quadratic surface drag
      }

      // Smoothing near surface

      if (/*wallX0Yp[VERT_DISTANCE] != 0 && */ wallX0Yp[VERT_DISTANCE] <= surfaceWindSmootingDist) { // above
        exchangeWith(texCoordX0Yp);
      }

      if (wallX0Ym[VERT_DISTANCE] > 0 /* && wallX0Ym[1] <= wallManhattanInfluence*/) { // below
        exchangeWith(texCoordX0Ym);
      }
      /*
            if (wallXmY0[1] != 0 && wallXmY0[1] <= wallManhattanInfluence) { // left
              exchangeWith(texCoordXmY0);
            }

            if (wallXpY0[1] != 0 && wallXpY0[1] <= wallManhattanInfluence) { // right
              exchangeWith(texCoordXpY0);
            }*/
    }

    if (wall[VERT_DISTANCE] <= 8) { // within height of buildings


      const float influenceDevider = float(wallVerticalInfluence); // devide by how many cells it's aplied to

      wall[VEGETATION] = wallX0Ym[VEGETATION];                     // vegetation is copied from below

      // base[PRESSURE] *= 0.995; // 0.999

      // base[PRESSURE]  += 0.001; // add air pressure at the suface. makes air rise everywhere and creates huge cells

      vec4 waterInSurface = texture(waterTex, texCoordX0Ym);

      switch (wall[TYPE]) {
      case WALLTYPE_FIRE:
        if (wall[VERT_DISTANCE] == 1) { // forest fire & one above surface
          float fireIntensity = calcFireIntensity(wall[VEGETATION], waterInSurface[SOIL_MOISTURE], water[PRECIPITATION]);

          fireIntensity = max(fireIntensity, 0.);
          base[TEMPERATURE] += fireIntensity;   // heat
          water[SMOKE] += fireIntensity * 2.0;  // smoke
          water[TOTAL] += fireIntensity * 0.50; // extra water from burning trees, both from water in the wood and from burning of hydrogen and hydrocarbons
        }
        // nobreak!
      case WALLTYPE_INDUSTRIAL:
        if (wall[TYPE] == WALLTYPE_INDUSTRIAL) { // exclude WALLTYPE_FIRE
          int texFragX = int(texCoord.x * resolution.x) % 80;

          if (wall[VERT_DISTANCE] == 5 && (texFragX == 18 || texFragX == 22)) { // cooling towers
            water[TOTAL] += 0.25;
            // base[TEMPERATURE] += 0.02;
            base.xy *= 0.5;
            base.y += 0.05;
          }

          else if (wall[VERT_DISTANCE] == 6 && texFragX == 29) { // smoke stack
            water[SMOKE] += 0.01;
            base[TEMPERATURE] += 0.02;
            base.xy *= 0.5;
          }
        }
        // nobreak!
      case WALLTYPE_URBAN:
        water[SMOKE] += 0.000002; // Urban produces smog
        base[TEMPERATURE] += 0.000010 * urbanHeatIslandStrength;
        // nobreak!
      case WALLTYPE_LAND:
        if (wall[VERT_DISTANCE] <= wallVerticalInfluence) {

          float dryStressFactor = map_rangeC(waterInSurface[SOIL_MOISTURE], 0.0, 25.0, 0.35, 1.0);
          float evaporation = calcEvaporation(realTemp, water[TOTAL], float(wall[VEGETATION]), waterInSurface[SOIL_MOISTURE]) * dryStressFactor / influenceDevider;

          water[TOTAL] += evaporation;
          base[TEMPERATURE] -= evaporation * evapHeat * 0.5;                                // evaporative cooling (half the real value, to prevent boring non convective conditions)

          if (wall[VEGETATION] < 10 && water[SOIL_MOISTURE] < 5.0) {                        // Dry desert area
            water[SMOKE] = min(water[SMOKE] + (max(abs(base[VX]) - 0.12, 0.) * 0.15), 2.4); // Dust blowing up with wind
          }
        }
        break;
      case WALLTYPE_WATER:
        if (wall[VERT_DISTANCE] <= wallVerticalInfluence) {
          float LocalWaterTemperature = texture(baseTex, texCoordX0Ym)[TEMPERATURE];                                       // water temperature
          base[TEMPERATURE] += (LocalWaterTemperature - realTemp - 1.0) / influenceDevider * waterHeatExchangeRate;        // air heated or cooled by water

          water[TOTAL] += max((maxWater(LocalWaterTemperature) - water[TOTAL]) * waterEvaporation / influenceDevider, 0.); // water evaporating
        }
        break;
      }
    }
  } else {                                                                 // this is wall

    wall[VERT_DISTANCE] = wallX0Yp[VERT_DISTANCE] - 1;                     // height below ground is counted

    if (wall[VERT_DISTANCE] < 0) {                                         // below surface
      water.ba = texture(waterTex, texCoordX0Yp).ba;                       // soil moisture and snow is copied from above
      wall[VEGETATION] = wallX0Yp[VEGETATION];                             // vegetation is copied from above

      if (wallX0Yp[DISTANCE] == 0) {                                       // if above is wall
        if (wallX0Yp[TYPE] != WALLTYPE_WATER) {                            // above is not water
          wall[TYPE] = wallX0Yp[TYPE];                                     // copy walltype from above
        } else if (wall[TYPE] == WALLTYPE_WATER) {                         // this is water
                                                                           //   wall[TYPE] = wallX0Yp[TYPE];                                     // land can't be over water. copy walltype from above
          base[TEMPERATURE] = texture(baseTex, texCoordX0Yp)[TEMPERATURE]; // copy water temperature from above
        }
      }

    } else if (wall[VERT_DISTANCE] == 0) { // at/in surface layer

      vec4 waterX0Yp = texture(waterTex, texCoordX0Yp);

      vec2 precipDeposition = texture(precipDepositionTex, texCoord).xy;

      vec4 lightAboveSurface = texture(lightTex, texCoordX0Yp); // sample cell above surface

      switch (wall[TYPE]) {
      case WALLTYPE_INDUSTRIAL:
        wall[VEGETATION] = min(wall[VEGETATION], 15); // limit vegetation in industrial areas
      case WALLTYPE_URBAN:
        wall[VEGETATION] = min(wall[VEGETATION], 75); // limit vegetation in urban areas
      case WALLTYPE_FIRE:
        if (wall[TYPE] == WALLTYPE_FIRE) {            // extra check to make sure it's not urban
          float fireIntensity = calcFireIntensity(wall[VEGETATION], water[SOIL_MOISTURE], waterX0Yp[PRECIPITATION]);

          // direct rain/snow-out extinguishes active fire quickly
          if (waterX0Yp[PRECIPITATION] > 0.055 || precipDeposition[RAIN_DEPOSITION] > 0.028 || precipDeposition[SNOW_DEPOSITION] > 0.02) {
            wall[TYPE] = WALLTYPE_LAND;
            water[SOIL_MOISTURE] = min(water[SOIL_MOISTURE] + 2.0, 60.0);
            water[SMOKE] *= 0.70;
          } else if (fireIntensity < minimalFireIntensity) { // fire goes out
            wall[TYPE] = WALLTYPE_LAND;                      // turn off fire
          } else if (int(iterNum) % (int(10. / fireIntensity) + 1) == 0) {
            wall[VEGETATION] -= 1;                           // reduce vegetation
            if (wall[VEGETATION] < 10)
              wall[TYPE] = WALLTYPE_LAND;                    // turn off fire
          }
        }
      case WALLTYPE_LAND:                                                                                          // no break,can also be fire or urban:
        float canopyBlock = map_rangeC(float(wall[VEGETATION]), 0.0, 127.0, 0.0, 0.35) * canopyInterception;
        float effectiveRain = precipDeposition[RAIN_DEPOSITION] * max(1.0 - canopyBlock, 0.35);
        float infiltration = effectiveRain * 0.1 * soilInfiltrationRate;
        float runoff = max(effectiveRain - infiltration, 0.0) * 0.04 * surfaceRunoffRate;
        water[SOIL_MOISTURE] = clamp(water[SOIL_MOISTURE] + infiltration - runoff, 0.0, 1000.0); // rain accumulation
        water[SNOW] = clamp(water[SNOW] + precipDeposition[SNOW_DEPOSITION] * snowMassToHeight, 0.0, 4000.0);      // snow accumulation in cm

        // Flooding / ponding: prolonged heavy rain can fill low-permeability land into standing water.
        float pondingSignal = max(effectiveRain - infiltration * 0.5, 0.0) + max(water[SOIL_MOISTURE] - 85.0, 0.0) * 0.0025;
        bool canFlood = wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_FIRE;
        if (canFlood && pondingSignal > 0.12 && water[SNOW] < 0.5 && wall[VEGETATION] < 36) {
          float floodChance = clamp((pondingSignal - 0.12) * 0.9, 0.0, 0.25);
          if (random2d(vec2(iterNum * 0.07 + fragCoord.x * 0.011, fragCoord.y * 0.019)) < floodChance) {
            wall[TYPE] = WALLTYPE_WATER;
            water[SOIL_MOISTURE] = 0.0;
            wall[VEGETATION] = int(float(wall[VEGETATION]) * 0.35);
            base[TEMPERATURE] = texture(baseTex, texCoordX0Yp)[TEMPERATURE];
          }
        }

        vec4 baseAboveSurface = texture(baseTex, texCoordX0Yp);
        vec4 waterAboveSurface = texture(waterTex, texCoordX0Yp);

        float realTempAboveSurface = potentialToRealT(baseAboveSurface[TEMPERATURE], texCoordX0Yp.y);

        float shadowFactor = clamp(1.0 - max(lightAboveSurface[SUNLIGHT], 0.0), 0.0, 1.0);
        float terrainShadowCooling = shadowFactor * 0.000020 * shadowCoolingStrength;
        base[TEMPERATURE] -= terrainShadowCooling;

        float evaporation = calcEvaporation(realTempAboveSurface, waterAboveSurface[TOTAL], float(wall[VEGETATION]), water[SOIL_MOISTURE]) * 0.08;

        water[SOIL_MOISTURE] -= evaporation;
        water[SOIL_MOISTURE] += precipDeposition[RAIN_DEPOSITION] * 0.03 + waterAboveSurface[CLOUD] * 0.002;


        if (int(iterNum) % 100 == 0) { // snow and soil moisture smoothing

          // average out snow cover
          const float snowSmoothingRate = 0.02; // max 0.9
          const float moistureSmoothingRate = 0.02;

          float numNeighbors = 0.;
          float totalNeighborSnow = 0.0;
          float totalNeighborSoilMoisture = 0.0;

          if (wallXmY0[VERT_DISTANCE] == 0 && (wallXmY0[TYPE] == WALLTYPE_LAND || wallXmY0[TYPE] == WALLTYPE_URBAN)) {
            totalNeighborSnow += texture(waterTex, texCoordXmY0)[SNOW];
            totalNeighborSoilMoisture += texture(waterTex, texCoordXmY0)[SOIL_MOISTURE];
            numNeighbors += 1.;
          }
          if (wallXpY0[VERT_DISTANCE] == 0 && (wallXpY0[TYPE] == WALLTYPE_LAND || wallXpY0[TYPE] == WALLTYPE_URBAN)) {
            totalNeighborSnow += texture(waterTex, texCoordXpY0)[SNOW];
            totalNeighborSoilMoisture += texture(waterTex, texCoordXpY0)[SOIL_MOISTURE];
            numNeighbors += 1.;
          }
          if (numNeighbors > 0.) { // prevent devide by 0
            float avgNeighborSnow = totalNeighborSnow / numNeighbors;
            water[SNOW] += (avgNeighborSnow - water[SNOW]) * snowSmoothingRate;

            float avgNeighborSoilMoisture = totalNeighborSoilMoisture / numNeighbors;
            water[SOIL_MOISTURE] += (avgNeighborSoilMoisture - water[SOIL_MOISTURE]) * moistureSmoothingRate;
          }

          // dynamic vegetation

          // Reworked vegetation system: climate carrying capacity + stress decay + slow recovery.
          float tempSuitability = map_rangeC(realTempAboveSurface, CtoK(-5.0), CtoK(28.0), 0.0, 1.0);
          float moistureSuitability = map_rangeC(water[SOIL_MOISTURE], 3.0, 40.0, 0.0, 1.0);
          float snowSuppression = map_rangeC(water[SNOW], 0.0, 120.0, 1.0, 0.25);
          float climateCapacity = clamp(tempSuitability * moistureSuitability * snowSuppression, 0.0, 1.0) * 127.0;
          float treeMassFactor = map_rangeC(float(wall[VEGETATION]), 0.0, 127.0, 0.65, 1.55);

          int vegetationGrowthRate = int(climateCapacity * 0.045 / treeMassFactor + sqrt(max(lightAboveSurface[SUNLIGHT], 0.0)) * 2.2);

          if (vegetationGrowthRate > 0 && int(iterNum) % ((100 / max(vegetationGrowthRate, 1)) * 100) == 0) {      // growth interval
            if (int(climateCapacity) > wall[VEGETATION])
              wall[VEGETATION] += 1;
          }

          // gradual dieback under persistent drought/heat stress
          float droughtStress = max(8.0 - water[SOIL_MOISTURE], 0.0) * map_rangeC(realTempAboveSurface, CtoK(16.0), CtoK(38.0), 0.0, 1.0);
          if (droughtStress > 0.0 && int(iterNum) % (80 + int(220.0 / (droughtStress + 1.0))) == 0)
            wall[VEGETATION] = max(wall[VEGETATION] - 1, 0);

          // Tree and structure wind physics (gust damage / flex proxy)
          float windSpeed = length(baseAboveSurface.xy);
          float gustStress = max(windSpeed - 0.045, 0.0);

          // Trees lose biomass in severe wind, especially when dry and unfrozen.
          if (wall[TYPE] == WALLTYPE_LAND && wall[VEGETATION] > 20 && gustStress > 0.0) {
            float treeRootStrength = map_rangeC(water[SOIL_MOISTURE], 2.0, 45.0, 0.65, 1.20);
            float snowLoadPenalty = map_rangeC(water[SNOW], 0.0, 120.0, 1.0, 0.65);
            float treeDamageChance = clamp(gustStress * 9.0 * (1.0 / treeRootStrength) * (1.0 / snowLoadPenalty), 0.0, 0.55);
            if (random2d(vec2(iterNum * 0.17, fragCoord.x * 0.11 + fragCoord.y * 0.07)) < treeDamageChance) {
              wall[VEGETATION] -= int(clamp(1.0 + gustStress * 30.0, 1.0, 8.0));
              wall[VEGETATION] = max(wall[VEGETATION], 0);
              water[SMOKE] += gustStress * 0.04; // debris/dust lofting
            }
          }

          // Urban / industrial storm damage under extreme winds.
          if ((wall[TYPE] == WALLTYPE_URBAN || wall[TYPE] == WALLTYPE_INDUSTRIAL) && gustStress > 0.025) {
            float structureResilience = wall[TYPE] == WALLTYPE_INDUSTRIAL ? 1.2 : 1.0;
            float destructionChance = clamp((gustStress - 0.025) * 5.0 / structureResilience, 0.0, 0.35);
            if (random2d(vec2(iterNum * 0.23, fragCoord.x * 0.19 + fragCoord.y * 0.13)) < destructionChance) {
              wall[TYPE] = WALLTYPE_LAND;
              wall[VEGETATION] = max(wall[VEGETATION], 8);
              water[SMOKE] += 0.08 + gustStress * 0.6;
              water[SOIL_MOISTURE] = max(water[SOIL_MOISTURE], 6.0);
            }
          }

          int subInterval = int(iterNum) / 100;

          if (subInterval % (int(water[SOIL_MOISTURE] * 0.1 + water[SNOW] * 0.5) + 10) == 0 && wall[VEGETATION] >= minimalFireVegetation &&
              (wallXmY0[TYPE] == WALLTYPE_FIRE || wallXpY0[TYPE] == WALLTYPE_FIRE || texture(waterTex, texCoordX0Yp)[SMOKE] > 4.5)) { // if left or right is on fire or fire is blowing over
            wall[TYPE] = WALLTYPE_FIRE;                                                                                               // spread fire
          }

          // Lightning ignition at the surface.
          float lightningAge = iterNum - lightningData[START_ITERNUM];
          if (wall[VERT_DISTANCE] == 0 && wall[TYPE] == WALLTYPE_LAND && wall[VEGETATION] >= minimalFireVegetation &&
              lightningData[INTENSITY] > 0.05 && lightningData[START_ITERNUM] > 0.0 && lightningAge >= 0.0 && lightningAge <= 3.0) {
            bool isCloudToGround = lightningData[INTENSITY] > 0.0;
            if (!isCloudToGround)
              break;

            float dxCells = abs(texCoord.x - lightningData.x) * resolution.x;
            dxCells = min(dxCells, resolution.x - dxCells); // map wraps horizontally

            float strikeToGroundY = max(lightningData.y - texCoord.y, 0.0) * resolution.y;
            float strikeDistanceCells = sqrt(dxCells * dxCells + strikeToGroundY * strikeToGroundY * 0.05);

            float lightningTemp = map_rangeC(lightningData[INTENSITY], 0.05, 4.5, 9000.0, 32000.0);
            float strikeRadiusCells = map_rangeC(lightningData[INTENSITY], 0.05, 4.5, 1.2, 7.2);
            float wetnessPenalty = clamp((water[SOIL_MOISTURE] - 6.0) * 0.03 + water[SNOW] * 0.15 + waterAboveSurface[PRECIPITATION] * 0.20, 0.0, 0.97);
            float treeFuelFactor = map_rangeC(float(wall[VEGETATION]), float(minimalFireVegetation), 127.0, 0.35, 1.0);
            float thermalFactor = map_rangeC(lightningTemp, 9000.0, 32000.0, 0.75, 1.30);
            float ignitionChance = clamp(map_rangeC(lightningData[INTENSITY], 0.05, 4.5, 0.16, 0.98) * treeFuelFactor * thermalFactor * (1.0 - wetnessPenalty) * lightningFireIgnitionBoost, 0.0, 1.0);

            float nearVegetationRadius = strikeRadiusCells * 2.1 * max(lightningNearbyIgnitionRadiusMult, 0.2);
            bool inNearbyVegetation = strikeDistanceCells > 0.45 && strikeDistanceCells <= nearVegetationRadius;
            if (inNearbyVegetation && random2d(vec2(iterNum * 0.97, fragCoord.x + fragCoord.y * 7.0)) < ignitionChance) {
              wall[TYPE] = WALLTYPE_FIRE;
            }

            // Lightning ground explosion: shock-heating, debris/smoke, and nearby tree ignition.
            float explosionRadiusCells = strikeRadiusCells * 1.55;
            if (strikeDistanceCells <= explosionRadiusCells) {
              float blast = 1.0 - strikeDistanceCells / max(explosionRadiusCells, 0.001);
              base[TEMPERATURE] += blast * lightningData[INTENSITY] * 0.004 * lightningFireIgnitionBoost;
              water[SMOKE] += blast * 0.22;

              if (wall[TYPE] == WALLTYPE_LAND && wall[VEGETATION] > 28 && random2d(vec2(iterNum * 0.41, fragCoord.x * 0.31 + fragCoord.y * 0.27)) < blast * 0.45)
                wall[TYPE] = WALLTYPE_FIRE;
            }
          }
          //}
        }
        break;
      case WALLTYPE_WATER:

        const float waterTempUpdateInterval = 20.0; // Update less often but with bigger value to reduce rounding error

        if (dynamicWaterTemperature >= 1.0 && mod(iterNum, waterTempUpdateInterval) < 0.5) {

          // average out temperature
          float numNeighbors = 0.;
          float totalNeighborTemp = 0.0;

          if (wallXmY0[TYPE] == WALLTYPE_WATER) { // left is water
            totalNeighborTemp += texture(baseTex, texCoordXmY0)[TEMPERATURE];
            numNeighbors += 1.;
          }
          if (wallXpY0[TYPE] == WALLTYPE_WATER) { // right is water
            totalNeighborTemp += texture(baseTex, texCoordXpY0)[TEMPERATURE];
            numNeighbors += 1.;
          }
          if (numNeighbors > 0.) { // prevent devide by 0
            float avgNeighborTemp = totalNeighborTemp / numNeighbors;
            base[TEMPERATURE] += (avgNeighborTemp - base[TEMPERATURE]) * 0.10;
          }
          if (base[TEMPERATURE] > 500.0) { // set water temperature for older savefiles
            base[TEMPERATURE] = CtoK(25.0);
          }

          float airTemperature = potentialToRealT(texture(baseTex, texCoordX0Yp)[TEMPERATURE], texCoordX0Yp.y);
          vec4 waterAboveSurfaceNow = texture(waterTex, texCoordX0Yp);
          vec4 precipFeedbackAbove = texture(precipFeedbackTex, texCoordX0Yp);

          float windMixing = clamp(length(texture(baseTex, texCoordX0Yp).xy) * 45.0, 0.2, 2.5);
          float precipMixing = map_rangeC(waterAboveSurfaceNow[PRECIPITATION], 0.0, 1.5, 0.0, 1.0);
          float mixedLayerDepth = map_rangeC((windMixing + precipMixing * 0.5) * coastalMixing, 0.2, 3.2, 0.8, 3.0); // deeper mixed layer => more thermal inertia

          float netWaterHeating = 0.0;
          netWaterHeating += (airTemperature - base[TEMPERATURE]) * waterHeatExchangeRate * (0.9 + windMixing * 0.15); // turbulent exchange

          float evaporativeCooling = max((maxWater(base[TEMPERATURE]) - waterAboveSurfaceNow[TOTAL]) * waterEvaporation, 0.) * evapHeat * 0.55;
          netWaterHeating -= evaporativeCooling;

          float rainCooling = max(precipFeedbackAbove[VAPOR], 0.0) * evapHeat * 0.16;
          float coldRainPulse = waterAboveSurfaceNow[PRECIPITATION] * map_rangeC(airTemperature, CtoK(-5.0), CtoK(20.0), 0.000035, 0.000008);
          netWaterHeating -= (rainCooling + coldRainPulse);

          float lightPower = max(lightAboveSurface[SUNLIGHT] * cos(sunAngle), 0.0); // Light power per horizontal surface area;
          float adjustedWaterAlbedo = clamp(ALBEDO_WATER + waterAlbedoShift, 0.02, 0.45);
          lightPower *= (1. - adjustedWaterAlbedo);
          lightPower *= lightHeatingConst;
          netWaterHeating += lightPower;

          float cloudGreenhouse = map_rangeC(waterAboveSurfaceNow[CLOUD] + waterAboveSurfaceNow[PRECIPITATION], 0.0, 2.5, 0.0, 0.000022);
          float smokeIRTrap = map_rangeC(waterAboveSurfaceNow[SMOKE], 0.0, 5.0, 0.0, 0.000010);
          float clearSkyIRLoss = map_rangeC(waterAboveSurfaceNow[TOTAL], 2.0, 20.0, 0.000018, 0.000006);

          netWaterHeating += lightAboveSurface[NET_HEATING]; // IR heating/cooling effect from atmosphere
          netWaterHeating += cloudGreenhouse + smokeIRTrap;
          netWaterHeating -= clearSkyIRLoss;

          // slow radiative cooling during calm clear night
          if (lightAboveSurface[SUNLIGHT] < 0.04) {
            float dryAirFactor = map_rangeC(waterAboveSurfaceNow[TOTAL], 2.0, 18.0, 1.0, 0.4);
            netWaterHeating -= 0.000010 * dryAirFactor;
          }

          base[TEMPERATURE] += netWaterHeating / (waterHeatCapacity * mixedLayerDepth) * waterTempUpdateInterval;
        }

        base[TEMPERATURE] = clamp(base[TEMPERATURE], CtoK(0.0), CtoK(maxWaterTemp)); // limit water temperature range

        wall[VEGETATION] = 20;
        water[SOIL_MOISTURE] = 100.0;
        water[SNOW] = 0.0;
        break;
      }
    }
  }
} // main
