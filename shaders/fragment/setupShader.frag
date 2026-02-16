#version 300 es
precision highp float;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform float dryLapse;

uniform float simHeight;

uniform float seed;
uniform float heightMult;

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

  float mountainMix = smoothstep(0.35, 0.95, continent);
  float elevation = mix(hills * 0.55 + 0.10, ridges * 0.95, mountainMix);

  // heightMult now controls water coverage + overall relief.
  float waterCoverage = map_rangeC(heightMult, 0.0, 2.0, 0.78, 0.25);
  float relief = map_rangeC(heightMult, 0.0, 2.0, 0.02, 0.55);

  float height = continent * elevation * relief - waterCoverage * 0.12;
  float terrainHeightNorm = clamp(height + 0.04, 0.0, 0.95); // 0..1 of simulation height

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

  float terrainHeightM = terrainHeightNorm * simHeight;
  float slopeProbe = abs(terrainHeightNormR - terrainHeightNormL) * resolution.x * 0.5;

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
      float urbanSuitability = lowlandFactor * flatlandFactor * smoothstep(0.45, 0.92, urbanNoise);

      float soilMoisture = mix(32.0, 8.0, smoothstep(0.0, 0.20, slopeProbe));
      soilMoisture *= mix(0.70, 1.20, fertileBand);
      soilMoisture *= mix(0.75, 1.15, aridNoise);
      soilMoisture *= mix(1.0, 0.72, urbanSuitability);
      water[SOIL_MOISTURE] = clamp(soilMoisture, 2.0, 45.0);

      float vegetation = 18.0 + fertileBand * 110.0 - slopeProbe * 55.0;
      vegetation += (noise2(vec2(x * 2.4 + seedB, seedA * 0.43)) - 0.5) * 30.0;
      vegetation *= mix(1.0, 0.38, urbanSuitability);
      wall[VEGETATION] = int(clamp(vegetation, 0.0, 127.0));

      if (urbanSuitability > 0.48) {
        wall[TYPE] = WALLTYPE_URBAN;
        wall[VEGETATION] = int(clamp(float(wall[VEGETATION]), 6.0, 72.0));

        if (industrialNoise > 0.72) {
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
