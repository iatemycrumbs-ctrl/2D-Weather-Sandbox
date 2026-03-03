#version 300 es
precision highp float;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform float dryLapse;

uniform float simHeight;

uniform float seed;
uniform float heightMult;
uniform float terrainRuggednessBoost;
uniform float terrainWetnessRecovery;
uniform float terrainRiverBias;

uniform vec4 initial_Tv[126];

float getInitialT(int y) { return initial_Tv[y / 4][y % 4]; }

in vec2 texCoord;
in vec2 fragCoord;

#include "common.glsl"

layout(location = 0) out vec4 base;
layout(location = 1) out vec4 water;
layout(location = 2) out ivec4 wall;

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise2(vec2 p)
{
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);

  float a = hash21(i + vec2(0.0, 0.0));
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p, float lacunarity, float gain, int octaves)
{
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;

  for (int i = 0; i < 8; i++) {
    if (i >= octaves)
      break;
    sum += (noise2(p * freq) * 2.0 - 1.0) * amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum;
}

float ridgedFbm(vec2 p)
{
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;

  for (int i = 0; i < 6; i++) {
    float n = noise2(p * freq) * 2.0 - 1.0;
    n = 1.0 - abs(n);
    n *= n;
    sum += n * amp;
    freq *= 2.0;
    amp *= 0.5;
  }

  return sum;
}

void main()
{
  base = vec4(0.0);
  water = vec4(0.0);

  // Reworked terrain generation:
  // - low frequency "continent" mask
  // - domain-warped FBM for hills/valleys
  // - ridged FBM for mountain chains

  float seedA = seed * 37.0 + 11.0;
  float seedB = seed * 91.0 + 7.0;

  // Terrain must be a single-valued surface (height as function of x only),
  // so noise is sampled in 2D with a seed-dependent Y slice.
  float x = texCoord.x * 6.0;

  vec2 p = vec2(x, seedA * 0.07);
  vec2 warp;
  warp.x = fbm(vec2(x * 0.8, seedB * 0.11), 2.1, 0.55, 4);
  warp.y = fbm(vec2(x * 1.2 + 19.3, seedA * 0.09), 2.1, 0.55, 4);

  vec2 pw = p + warp * vec2(0.90, 0.25);

  float continent = fbm(pw * vec2(0.22, 1.0) + vec2(seedA * 0.13, seedB * 0.19), 2.0, 0.55, 5);
  continent = smoothstep(-0.45, 0.35, continent);

  float hills = fbm(pw * vec2(0.90, 1.0) + vec2(seedA * 0.21, seedB * 0.27), 2.0, 0.52, 6);
  float ridges = ridgedFbm(pw * vec2(1.35, 1.0) + vec2(seedA * 0.31, seedB * 0.17));

  float mountainMix = smoothstep(0.35, 0.95, continent) * terrainRuggednessBoost;
  mountainMix = clamp(mountainMix, 0.0, 1.0);
  float riverValley = smoothstep(0.18, 0.95, abs(fbm(pw * vec2(1.65, 1.0) + vec2(seedB * 0.27, seedA * 0.14), 2.0, 0.5, 4))) * terrainRiverBias;
  float elevationRaw = mix(hills * 0.52 + 0.11, ridges * 0.78, mountainMix) - riverValley * 0.07;

  // heightMult now controls water coverage + overall relief.
  float waterCoverage = map_rangeC(heightMult, 0.0, 2.0, 0.78, 0.25);
  float relief = map_rangeC(heightMult, 0.0, 2.0, 0.03, 0.36) * mix(0.82, 1.10, clamp(terrainRuggednessBoost - 0.5, 0.0, 1.5) / 1.5);

  // Estimate slope from neighboring x samples instead of screen-space derivatives.
  float xStep = texelSize.x * 6.0;
  vec2 pL = vec2(x - xStep, seedA * 0.07);
  vec2 pR = vec2(x + xStep, seedA * 0.07);
  vec2 warpL = vec2(fbm(vec2((x - xStep) * 0.8, seedB * 0.11), 2.1, 0.55, 4),
                    fbm(vec2((x - xStep) * 1.2 + 19.3, seedA * 0.09), 2.1, 0.55, 4));
  vec2 warpR = vec2(fbm(vec2((x + xStep) * 0.8, seedB * 0.11), 2.1, 0.55, 4),
                    fbm(vec2((x + xStep) * 1.2 + 19.3, seedA * 0.09), 2.1, 0.55, 4));
  vec2 pwL = pL + warpL * vec2(0.90, 0.25);
  vec2 pwR = pR + warpR * vec2(0.90, 0.25);
  float continentL = smoothstep(-0.45, 0.35, fbm(pwL * vec2(0.22, 1.0) + vec2(seedA * 0.13, seedB * 0.19), 2.0, 0.55, 5));
  float continentR = smoothstep(-0.45, 0.35, fbm(pwR * vec2(0.22, 1.0) + vec2(seedA * 0.13, seedB * 0.19), 2.0, 0.55, 5));
  float hillsL = fbm(pwL * vec2(0.90, 1.0) + vec2(seedA * 0.21, seedB * 0.27), 2.0, 0.52, 6);
  float hillsR = fbm(pwR * vec2(0.90, 1.0) + vec2(seedA * 0.21, seedB * 0.27), 2.0, 0.52, 6);
  float ridgesL = ridgedFbm(pwL * vec2(1.35, 1.0) + vec2(seedA * 0.31, seedB * 0.17));
  float ridgesR = ridgedFbm(pwR * vec2(1.35, 1.0) + vec2(seedA * 0.31, seedB * 0.17));
  float elevationL = mix(hillsL * 0.55 + 0.10, ridgesL * 0.95, smoothstep(0.35, 0.95, continentL));
  float elevationR = mix(hillsR * 0.55 + 0.10, ridgesR * 0.95, smoothstep(0.35, 0.95, continentR));
  float terrainHeightNormL = clamp(continentL * elevationL * relief - waterCoverage * 0.12 + 0.04, 0.0, 0.95);
  float terrainHeightNormR = clamp(continentR * elevationR * relief - waterCoverage * 0.12 + 0.04, 0.0, 0.95);

  float elevation = mix(elevationRaw, (elevationL + elevationRaw + elevationR) / 3.0, 0.48);
  float terrainHeightNorm = clamp(continent * elevation * relief - waterCoverage * 0.12 + 0.04, 0.0, 0.95);
  terrainHeightNorm = mix(terrainHeightNorm, smoothstep(0.0, 1.0, terrainHeightNorm), 0.28);
  terrainHeightNorm = mix(terrainHeightNorm, (terrainHeightNormL + terrainHeightNorm + terrainHeightNormR) / 3.0, 0.42);

  // Terrain rework: broad valleys, river-carved channels and mesoscale roughness blend.
  float valleyNoise = fbm(vec2(x * 0.42 + seedA * 0.37, seedB * 0.29), 2.0, 0.55, 5);
  float valleyMask = smoothstep(0.42, 0.78, valleyNoise) * smoothstep(0.12, 0.58, continent);
  float riverAxis = abs(sin((x + seedB * 0.13) * 14.0 + fbm(vec2(x * 1.9, seedA * 0.2), 2.0, 0.5, 4) * 2.4));
  float riverCut = smoothstep(0.0, 0.20, 0.20 - riverAxis);
  float roughness = fbm(vec2(x * 3.2 + seedB * 0.11, seedA * 0.17), 2.1, 0.58, 4) * 0.035;

  terrainHeightNorm = max(terrainHeightNorm - valleyMask * 0.08 - riverCut * 0.06 + roughness, 0.0);

  float terrainHeightM = terrainHeightNorm * simHeight;
  float slopeProbe = abs(terrainHeightNormR - terrainHeightNormL) * resolution.x * 0.38;

  if (texCoord.y < texelSize.y || texCoord.y < terrainHeightNorm) {
    wall[DISTANCE] = 0;

    if (terrainHeightNorm <= texelSize.y) {
      wall[TYPE] = WALLTYPE_WATER;
      base[TEMPERATURE] = CtoK(23.0);
      water[SOIL_MOISTURE] = 0.0;
      wall[VEGETATION] = 0;
      water[SNOW] = 0.0;
    } else {
      wall[TYPE] = WALLTYPE_LAND;

      float fertileBand = smoothstep(150.0, 2500.0, terrainHeightM) * (1.0 - smoothstep(2800.0, 4200.0, terrainHeightM));
      float aridNoise = noise2(vec2(x * 1.35 + seedA, seedB * 0.31));

      // pre-generated urban belts on lower, flatter terrain
      float urbanNoise = noise2(vec2(x * 0.45 + seedA * 0.12, seedB * 0.77));
      float industrialNoise = noise2(vec2(x * 1.10 + seedB * 0.63, seedA * 0.39));
      float lowlandFactor = 1.0 - smoothstep(700.0, 1700.0, terrainHeightM);
      float flatlandFactor = 1.0 - smoothstep(0.06, 0.24, slopeProbe);
      float urbanSuitability = lowlandFactor * flatlandFactor * smoothstep(0.40, 0.90, urbanNoise);

      float sandBiomeNoise = noise2(vec2(x * 0.78 + seedA * 0.77, seedB * 0.49));
      float desertBasin = smoothstep(0.46, 0.90, sandBiomeNoise) * smoothstep(0.0, 0.30, lowlandFactor);

      float soilMoisture = mix(38.0, 14.0, smoothstep(0.0, 0.20, slopeProbe));
      soilMoisture *= mix(0.70, 1.20, fertileBand);
      soilMoisture *= mix(0.88, 1.18, aridNoise);
      soilMoisture *= mix(1.0, 0.72, urbanSuitability);
      soilMoisture *= mix(1.0, 0.22, desertBasin);
      soilMoisture *= terrainWetnessRecovery;
      water[SOIL_MOISTURE] = clamp(soilMoisture, 1.5, 60.0);

      // Physical tree proxy: higher values represent denser/taller canopy stands, not just simple sprite count.
      float vegetation = 14.0 + fertileBand * 108.0 - slopeProbe * 46.0;
      vegetation += (noise2(vec2(x * 2.4 + seedB, seedA * 0.43)) - 0.5) * 28.0;
      vegetation *= mix(1.0, 0.38, urbanSuitability);
      vegetation *= mix(1.0, 0.10, desertBasin);
      wall[VEGETATION] = int(clamp(vegetation, 0.0, 127.0));

      if (urbanSuitability > 0.44) {
        wall[TYPE] = WALLTYPE_URBAN;
        wall[VEGETATION] = int(clamp(float(wall[VEGETATION]), 6.0, 72.0));

        if (industrialNoise > 0.64) {
          wall[TYPE] = WALLTYPE_INDUSTRIAL;
          wall[VEGETATION] = int(clamp(float(wall[VEGETATION]), 0.0, 18.0));
        }
      }

      float snowBase = map_rangeC(terrainHeightM, 1800.0, 5200.0, 0.0, 180.0);
      float snowNoise = noise2(vec2(x * 1.75 + seedA * 0.2, seedB * 0.2));
      water[SNOW] = max(snowBase * mix(0.75, 1.25, snowNoise), 0.0);
    }
  } else {
    wall[DISTANCE] = 255;
    base[TEMPERATURE] = getInitialT(int(texCoord.y * (1.0 / texelSize.y)));

    float realTemp = potentialToRealT(base[TEMPERATURE]);

    if (texCoord.y < 0.20)
      water[TOTAL] = maxWater(realTemp - 2.0);
    else
      water[TOTAL] = maxWater(realTemp - 20.0);

    water[CLOUD] = max(water[TOTAL] - maxWater(realTemp), 0.0);
  }

  wall[VERT_DISTANCE] = 100;
}
