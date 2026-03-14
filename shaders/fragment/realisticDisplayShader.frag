#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;    // pixel
in vec2 texCoord;     // this normalized

in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

in vec2 onScreenUV;

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;
uniform sampler2D lightTex;
uniform sampler2D noiseTex;
uniform sampler2D surfaceTextureMap;
uniform sampler2D curlTex;
uniform sampler2D lightningTex;
uniform sampler2D lightningDataTex;

uniform sampler2D ambientLightTex;

uniform vec2 aspectRatios; // [0] Sim       [1] canvas

#define URBAN 0
#define FIRE_FOREST 1
#define SNOW_FOREST 2
#define FOREST 3
#define INDUS 4


uniform vec2 resolution; // sim resolution
uniform vec2 texelSize;

uniform float cellHeight; // in meters

uniform float dryLapse;
uniform float sunAngle;

uniform float minShadowLight;
uniform float lightningColorTempMult;
uniform float lightningFlashPersistence;
uniform float lightningTempMinK;
uniform float lightningTempMaxK;
uniform float precipitationShaftStrength;
uniform float precipitationMistStrength;
uniform float precipitationSparkle;
uniform float ambientScattering;
uniform float cloudLayerComplexity;
uniform float lightningBloomStrength;
uniform float flashlightIntensity;
uniform float flashlightFocus;
uniform float flashlightRange;
uniform float radiationHaze;
uniform float electricFieldVizStrength;
uniform float dynamicChargeSeparation;
uniform float electricFieldDiffusion;
uniform float mobileLightningVisibility;
uniform int lightningRodCount;
uniform vec2 lightningRodPos[8];
uniform int showLightningRods;

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // Xpos   Ypos  Size   type

uniform float displayVectorField;

uniform float iterNum;
uniform float lightningAnimIter;
uniform float lightningTexturePhase;
uniform int lightningShapeMode;
uniform float lightningSegmentSmoothness;

out vec4 fragmentColor;

#include "common.glsl"

#include "commonDisplay.glsl"

vec4 base, water;
ivec4 wall;
float lightIntensity;

vec3 color;
float opacity = 1.0;

vec3 emittedLight = vec3(0.); // pure light, like lightning

float shadowLight;

vec3 onLight; // extra light that lights up objects, just like sunlight and shadowlight


const vec3 bareDrySoilCol = pow(vec3(0.85, 0.60, 0.40), vec3(GAMMA));
const vec3 bareWetSoilCol = pow(vec3(0.5, 0.2, 0.1), vec3(GAMMA));
const vec3 greenGrassCol = pow(vec3(0.0, 0.7, 0.2), vec3(GAMMA));
const vec3 dryGrassCol = pow(vec3(0.843, 0.588, 0.294), vec3(GAMMA));


vec4 surfaceTexture(int index, vec2 pos)
{
#define numTextures 5.;             // number of textures in the map
  const float texRelHeight = 1. / numTextures;
  pos.y = clamp(pos.y, 0.01, 0.99); // make sure position is within the subtexture
  pos /= numTextures;
  pos.y += float(index) * texRelHeight;
  return texture(surfaceTextureMap, pos);
}


vec3 getWallColor(float depth)
{
  vec3 vegetationCol = mix(greenGrassCol, dryGrassCol, max(1.0 - water[SOIL_MOISTURE] * (1. / fullGreenSoilMoisture), 0.0));
  vec3 bareSoilCol = mix(bareDrySoilCol, bareWetSoilCol, map_rangeC(water[SOIL_MOISTURE], 0.0, 20.0, 0.0, 1.0));

  float vegFrac = min(float(wall[VEGETATION]) / 50.0, 1.0);
  vec3 surfCol = mix(bareSoilCol, vegetationCol, vegFrac);

  float broadPatch = texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.06).r;
  float finePatch = texture(noiseTex, vec2(texCoord.x * resolution.x + 117.0, texCoord.y * resolution.y - 43.0) * 0.28).r;
  float reliefPatch = texture(noiseTex, vec2(texCoord.x * resolution.x * 0.11 - 51.0, texCoord.y * resolution.y * 0.13 + 77.0)).r;
  vec3 canopyTint = mix(vec3(0.82, 1.05, 0.82), vec3(1.10, 0.92, 0.78), broadPatch);
  vec3 bladeTint = mix(vec3(0.88, 0.96, 0.88), vec3(1.08, 1.10, 0.92), finePatch);
  surfCol = mix(surfCol, surfCol * canopyTint * bladeTint, vegFrac * 0.45);

  vec3 color;
  if (wall[TYPE] == WALLTYPE_URBAN) {
    float blockGrid = step(0.58, fract(texCoord.x * resolution.x * 0.18)) * step(0.58, fract(texCoord.y * resolution.y * 0.18));
    vec3 concrete = mix(vec3(0.42, 0.45, 0.50), vec3(0.30, 0.33, 0.38), broadPatch);
    vec3 asphalt = mix(vec3(0.18, 0.19, 0.21), vec3(0.24, 0.24, 0.26), finePatch);
    color = mix(concrete, asphalt, blockGrid * 0.45 + depth * 0.08);
  } else if (wall[TYPE] == WALLTYPE_INDUSTRIAL) {
    bool skyscraperProxy = wall[VEGETATION] < 10;
    if (skyscraperProxy) {
      float verticalBands = step(0.48, fract(texCoord.x * resolution.x * 0.26));
      float windowRows = step(0.44, fract(texCoord.y * resolution.y * 0.24));
      float lit = verticalBands * windowRows;
      vec3 towerBase = mix(vec3(0.16, 0.19, 0.24), vec3(0.24, 0.28, 0.34), broadPatch);
      vec3 windowGlow = vec3(0.55, 0.68, 0.82) * (0.25 + 0.75 * finePatch);
      color = mix(towerBase, windowGlow, lit * 0.38);
    } else {
      float metalPanel = step(0.5, fract(texCoord.x * resolution.x * 0.12 + broadPatch));
      vec3 steel = mix(vec3(0.34, 0.36, 0.39), vec3(0.24, 0.26, 0.30), finePatch);
      vec3 rust = vec3(0.43, 0.30, 0.22);
      color = mix(steel, rust, metalPanel * 0.16 + depth * 0.06);
    }
  } else if (wall[TYPE] == WALLTYPE_FIRE) {
    float flame = clamp(water[SMOKE] * 1.8 + finePatch * 0.25, 0.0, 1.0);
    vec3 charCol = vec3(0.09, 0.06, 0.05);
    vec3 emberCol = vec3(1.00, 0.46, 0.10);
    vec3 coreCol = vec3(1.0, 0.88, 0.64);
    color = mix(charCol, mix(emberCol, coreCol, broadPatch), flame);
  } else {
    vec3 rockCol = mix(vec3(0.42, 0.44, 0.46), vec3(0.66, 0.62, 0.58), clamp(reliefPatch * 1.15, 0.0, 1.0));
    float terrainSlopeTint = smoothstep(0.15, 0.88, depth + (reliefPatch - 0.5) * 0.35);
    color = mix(surfCol, rockCol, clamp(depth * 0.42 + terrainSlopeTint * 0.18, 0.0, 1.0));
  }

  color *= mix(vec3(0.88), vec3(1.12), texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.20).rgb);
  color = mix(color, vec3(1.0), clamp(min(water[SNOW], fullWhiteSnowHeight) / fullWhiteSnowHeight - max(depth * 0.3, 0.0), 0.0, 1.0));

  return color;
}

const vec2 lightningTexRes = vec2(2500, 5000);
const float lightningTexAspect = lightningTexRes.x / lightningTexRes.y;

float calcLightningTime(float startIterNum)
{
  if (startIterNum <= 0.0)
    return 1000.0;
  float lightningTime = max(lightningAnimIter - startIterNum, 0.0);
  return lightningTime / max(2.55 * lightningFlashPersistence, 0.01);
}

float lightningChannelEnvelope(float T, bool isIC)
{
  // Stepped-leader + return-stroke timing model with short restrikes.
  float leaderRise = 1.0 - exp(-T * (isIC ? 8.5 : 11.0));
  float leaderDecay = exp(-T * (isIC ? 3.2 : 4.1));
  float returnStroke = exp(-pow(max(T - (isIC ? 0.17 : 0.12), 0.0) / (isIC ? 0.23 : 0.18), 2.0)) * (isIC ? 0.85 : 1.15);
  float restrike1 = exp(-pow(max(T - 0.42, 0.0) / 0.16, 2.0)) * (isIC ? 0.32 : 0.55);
  float restrike2 = exp(-pow(max(T - 0.74, 0.0) / 0.18, 2.0)) * (isIC ? 0.18 : 0.34);
  float glowTail = exp(-T * (isIC ? 0.85 : 1.05)) * (isIC ? 0.26 : 0.21);
  return leaderRise * leaderDecay * (isIC ? 1.8 : 2.5) + returnStroke + restrike1 + restrike2 + glowTail;
}

vec2 lightningWarpOffset(vec2 uv, float lightningTime, vec2 seed, float strikeTypeSign)
{
  float shapeWarpMult = 1.0;
  if (lightningShapeMode == 1)
    shapeWarpMult = 0.75; // Ribbon Arc
  else if (lightningShapeMode == 2)
    shapeWarpMult = 1.28; // Branch Spider
  else if (lightningShapeMode == 3)
    shapeWarpMult = 1.55; // Chaotic Fractal

  if (strikeTypeSign < 0.0) {
    float axis = uv.x;
    float meander = sin(axis * 31.0 + lightningTime * 1.8 + random2d(seed * 17.1) * 6.2831) * 0.0075 * shapeWarpMult;
    meander += sin(axis * 74.0 + lightningTime * 1.3 + random2d(seed * 7.3) * 6.2831) * 0.0030 * shapeWarpMult;
    float filament = sin((axis * 108.0 + lightningTime * 6.0) + uv.y * 15.0) * 0.0013 * shapeWarpMult;
    return vec2(0.0, (meander + filament) * 0.36);
  }

  float axis = uv.y;
  float meander = sin(axis * 42.0 + lightningTime * 2.5 + random2d(seed * 13.2) * 6.2831) * 0.0100 * shapeWarpMult;
  meander += sin(axis * 89.0 + lightningTime * 1.9 + random2d(seed * 5.6) * 6.2831) * 0.0042 * shapeWarpMult;
  float filament = sin((axis * 142.0 + lightningTime * 7.8) + uv.x * 22.0) * 0.0018 * shapeWarpMult;
  return vec2(meander + filament, 0.0);
}

vec2 remapICLightningUV(vec2 baseCoord, vec2 pos, float scaleMult)
{
  vec2 uv = vec2(0.5);
  float wrappedDx = mod((texCoord.x - pos.x) + 1.5, 1.0) - 0.5;
  vec2 rel = vec2(wrappedDx, texCoord.y - pos.y);

  float branchAngle = (random2d(pos * 27.9) - 0.5) * 0.80;
  float driftAngle = (random2d(pos * 41.7 + vec2(1.0)) - 0.5) * 0.40;
  float angle = branchAngle + driftAngle;

  vec2 dir = normalize(vec2(cos(angle), sin(angle) * 0.32));
  vec2 perp = vec2(-dir.y, dir.x);

  float along = dot(rel, dir);
  float across = dot(rel, perp);
  float cloudDrift = sin((texCoord.y - pos.y) * 18.0 + random2d(pos * 21.7) * 6.2831) * 0.08;
  float anvilShear = (texCoord.y - pos.y) * 0.20;

  uv.x = 0.5 + (along + cloudDrift + anvilShear) * scaleMult * aspectRatios[0] * 2.12;
  uv.y = 0.5 + across * scaleMult * 1.18;
  return uv;
}

vec2 remapCGLightningUV(vec2 baseCoord, vec2 pos, float scaleMult)
{
  vec2 uv = vec2(0.5);
  float wrappedDx = mod((texCoord.x - pos.x) + 1.5, 1.0) - 0.5;

  // Normalize vertical texture traversal so the channel head starts near cloud base
  // and reaches terrain with continuous (non-stepped) channel curvature.
  float sourceToGround = max(pos.y, 0.08);
  float verticalTravel = clamp((pos.y - texCoord.y) / sourceToGround, 0.0, 1.0);

  float seedA = random2d(pos * 19.3);
  float seedB = random2d(pos * 43.1 + vec2(1.7));
  float seedC = random2d(pos * 53.2 + vec2(3.1));

  // Piecewise leader offsets avoid the old fixed snake-like sinusoid while preserving realism.
  float seg1 = (seedA - 0.5) * 0.030;
  float seg2 = (seedB - 0.5) * 0.040;
  float seg3 = (seedC - 0.5) * 0.034;
  float seg4 = (random2d(pos * 61.7 + vec2(5.3)) - 0.5) * 0.028;
  float t1 = smoothstep(0.00, 0.25, verticalTravel);
  float t2 = smoothstep(0.25, 0.50, verticalTravel);
  float t3 = smoothstep(0.50, 0.75, verticalTravel);
  float t4 = smoothstep(0.75, 1.00, verticalTravel);
  float segmentedOffset = seg1 * (1.0 - t1) + mix(seg1, seg2, t2) * (1.0 - t3) + mix(seg2, seg3, t3) * (1.0 - t4) + mix(seg3, seg4, t4);

  float leaderJitter = (random2d(vec2(verticalTravel * 47.0 + pos.x * 9.0, pos.y * 13.0)) - 0.5) * mix(0.0006, (0.004 + (1.0 - verticalTravel) * 0.005), 1.0 - lightningSegmentSmoothness);
  float leaderLean = sign(wrappedDx + 0.0001) * wrappedDx * wrappedDx * 0.07;
  uv.x = 0.5 + (wrappedDx + segmentedOffset + leaderJitter + leaderLean) * scaleMult * aspectRatios[0] / lightningTexAspect * 0.72;
  uv.y = verticalTravel * 1.26;
  return uv;
}

float lightningShapeWarpMultiplier()
{
  if (lightningShapeMode == 1)
    return 0.80; // Ribbon Arc
  if (lightningShapeMode == 2)
    return 1.24; // Branch Spider
  if (lightningShapeMode == 3)
    return 1.62; // Chaotic Fractal
  return 1.0; // Forked Classic
}

vec2 lightningAxes(vec2 uv, bool isIC)
{
  // x: progression along channel, y: lateral displacement from trunk center.
  return isIC ? vec2(uv.x, uv.y - 0.5) : vec2(uv.y, uv.x - 0.5);
}

float proceduralLightningSkeleton(vec2 uv, vec2 pos, float lightningTime, bool isIC)
{
  vec2 axis = lightningAxes(uv, isIC);
  float along = clamp(axis.x, 0.0, 1.20);
  float across = axis.y;
  float shapeWarp = lightningShapeWarpMultiplier();

  float seedA = random2d(pos * vec2(27.1, 41.9));
  float seedB = random2d(pos * vec2(13.7, 23.3) + vec2(4.2, 1.7));
  float seedC = random2d(pos * vec2(9.1, 17.5) + vec2(7.9, 3.8));

  float smoothMeander = sin(along * (isIC ? 34.0 : 22.0) + seedA * 6.2831 + lightningTime * 2.4) * (isIC ? 0.014 : 0.010) * shapeWarp;
  smoothMeander += sin(along * (isIC ? 63.0 : 31.0) + seedB * 6.2831 + lightningTime * 3.1) * (isIC ? 0.010 : 0.006) * shapeWarp;
  float trunkCenter = smoothMeander + (seedC - 0.5) * (isIC ? 0.020 : 0.014) * shapeWarp;

  float coreWidth = mix(0.013, 0.0072, smoothstep(0.0, 1.0, along));
  if (!isIC)
    coreWidth *= 1.08;
  coreWidth *= mix(1.18, 0.92, shapeWarp - 0.8);
  float trunk = exp(-pow(abs(across - trunkCenter) / max(coreWidth, 0.0025), 1.22));

  float branchField = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float spawn = mix(0.10, 0.78, random2d(pos * (7.9 + fi * 1.7) + vec2(1.4 + fi, 9.8 + fi * 2.3)));
    float branchLen = mix(0.12, 0.42, random2d(pos * (18.3 + fi * 0.9) + vec2(3.1 + fi * 0.7, 6.2)));
    float branchMask = smoothstep(spawn, spawn + 0.02, along) * (1.0 - smoothstep(spawn + branchLen - 0.03, spawn + branchLen + 0.03, along));

    float dirSign = random2d(pos * (31.4 + fi * 0.8) + vec2(8.2 + fi * 0.4, 4.5)) > 0.5 ? 1.0 : -1.0;
    float localT = clamp((along - spawn) / max(branchLen, 0.001), 0.0, 1.0);
    float branchSpread = dirSign * localT * (isIC ? 0.15 : 0.18) * shapeWarp;
    float branchJitter = sin(localT * (17.0 + fi * 3.5) + seedA * 11.0 + lightningTime * 6.0) * mix(0.003, 0.014, 1.0 - lightningSegmentSmoothness) * shapeWarp;
    float branchCenter = trunkCenter + branchSpread + branchJitter;
    float branchWidth = mix(0.007, 0.0035, localT) * mix(1.0, 0.84, shapeWarp - 0.8);

    float branch = exp(-pow(abs(across - branchCenter) / max(branchWidth, 0.002), 1.34));
    branchField = max(branchField, branch * branchMask);
  }

  float leaderPulse = 0.95 + 0.05 * sin(along * 23.0 - lightningTime * 8.0 + seedB * 6.2831);
  float continuity = isIC ? (0.86 + 0.14 * sin(along * 22.0 + lightningTime * 3.6 + seedC * 6.2831)) : 1.0;

  float skeleton = max(trunk, branchField * 0.95);
  return skeleton * leaderPulse * continuity;
}

float lightningIntensityOverTime(float Tin, vec2 lightningPos, float intensity)
{
  float T0 = Tin - 1.0;

  bool isIC = intensity < 0.0;
  float absIntensity = abs(intensity);
  float T = max(T0, 0.0);
  if (T > 3.2)
    return 0.0;

  float channelEnvelope = lightningChannelEnvelope(T, isIC);

  // Layered flicker: low-frequency plasma breathing + high-frequency stepping.
  float phase = random2d(lightningPos * 9.17) * 6.2831;
  float flickerLF = 0.95 + 0.05 * sin(T * (isIC ? 4.8 : 3.6) + phase);
  float flickerHF = 0.92 + 0.08 * sin(T * (isIC ? 32.0 : 28.0) + phase * 1.9);

  float dampedIntensity = pow(clamp(absIntensity, 0.0, 4.0), 1.45);
  return channelEnvelope * max(flickerLF * flickerHF, 0.82) * dampedIntensity;
}

vec3 displayLightning(vec2 pos, float lightningTime, float currentLightningIntensity)
{
  float signedIntensity = currentLightningIntensity;
  float strikeTypeSign = signedIntensity < 0.0 ? -1.0 : 1.0;
  float absIntensity = abs(currentLightningIntensity);
  if (absIntensity < 0.00001)
    return vec3(0.0);

  vec2 lightningTexCoord = texCoord;
  float phaseDrift = fract(lightningTexturePhase + random2d(pos * 11.3) * 0.37);
  lightningTexCoord.x -= mod(pos.x + phaseDrift * 0.22, 1.0);
  lightningTexCoord.y -= pos.y;

  float scaleMult = 1.0;
  if (strikeTypeSign < 0.0) {
    float icAnchorY = clamp(pos.y, 0.34, 0.88);
    scaleMult = 1.0 / max(0.24 + abs(icAnchorY - 0.50), 0.34);
    lightningTexCoord = remapICLightningUV(lightningTexCoord, pos, scaleMult);
  } else {
    float cgSourceY = clamp(pos.y, 0.26, 0.72);
    scaleMult = 1.0 / max(cgSourceY * 0.90, 0.18);
    lightningTexCoord = remapCGLightningUV(lightningTexCoord, pos, scaleMult);
  }

  if (lightningTexCoord.x < -0.40 || lightningTexCoord.x > 1.40 || lightningTexCoord.y < -0.35 || lightningTexCoord.y > 1.40)
    return vec3(0.0);

  // Hybrid channel reconstruction: sampled texture + procedural segmented leader/branches.
  vec2 px = vec2(1.0 / lightningTexRes.x, 1.0 / lightningTexRes.y);
  float trunk = texture(lightningTex, lightningTexCoord).r;
  float side = max(texture(lightningTex, lightningTexCoord + vec2(px.x * 1.2, 0.0)).r,
                   texture(lightningTex, lightningTexCoord - vec2(px.x * 1.2, 0.0)).r);
  float vertical = max(texture(lightningTex, lightningTexCoord + vec2(0.0, px.y * 1.4)).r,
                       texture(lightningTex, lightningTexCoord - vec2(0.0, px.y * 1.4)).r);
  float diag = max(max(texture(lightningTex, lightningTexCoord + vec2(px.x, px.y)).r,
                       texture(lightningTex, lightningTexCoord + vec2(-px.x, px.y)).r),
                   max(texture(lightningTex, lightningTexCoord + vec2(px.x, -px.y)).r,
                       texture(lightningTex, lightningTexCoord + vec2(-px.x, -px.y)).r));
  float sampledLightning = max(trunk, max(side, vertical) * 0.72);
  sampledLightning = max(sampledLightning, diag * 0.58);

  float proceduralSkeleton = proceduralLightningSkeleton(lightningTexCoord, pos, lightningTime, strikeTypeSign < 0.0);
  float pixVal = max(mix(sampledLightning * 0.95, sampledLightning * 0.78, 1.0 - lightningSegmentSmoothness), mix(sampledLightning, proceduralSkeleton, 0.70 - lightningSegmentSmoothness * 0.28));

  // Keep IC in cloud and CG mostly below source cloud.
  if (strikeTypeSign < 0.0) {
    float icCloudBand = smoothstep(0.46, 0.58, texCoord.y) * (1.0 - smoothstep(0.92, 0.99, texCoord.y));
    float localCloudMask = smoothstep(0.028, 0.15, water[CLOUD] + water[PRECIPITATION] * 0.38);
    pixVal *= icCloudBand * localCloudMask;
  } else {
    float belowSource = 1.0 - smoothstep(pos.y - 0.02, pos.y + 0.04, texCoord.y);
    float nearGround = smoothstep(0.55, 1.00, lightningTexCoord.y);
    float corridorWidth = mix(0.22, 0.40, nearGround);
    float cgLateralConfine = 1.0 - smoothstep(corridorWidth, corridorWidth + 0.30, abs(lightningTexCoord.x - 0.5));
    cgLateralConfine = max(cgLateralConfine, 0.16);
    pixVal *= belowSource * cgLateralConfine;
  }

  float channelFade = clamp(absIntensity * (strikeTypeSign > 0.0 ? 0.10 : 0.08), 0.0, 1.0);
  float tailFade = 1.0 - smoothstep(strikeTypeSign > 0.0 ? 1.0 : 0.9, strikeTypeSign > 0.0 ? 2.2 : 2.0, lightningTime);
  pixVal *= channelFade * max(tailFade, 0.0);

  float ionizedEdge = smoothstep(0.18, 0.95, pixVal);
  vec3 channelCoreCol = strikeTypeSign < 0.0 ? vec3(0.56, 0.46, 0.98) : vec3(0.48, 0.72, 1.0);
  vec3 channelRimCol = strikeTypeSign < 0.0 ? vec3(0.95, 0.84, 1.0) : vec3(0.93, 0.98, 1.0);
  vec3 lightningCol = mix(channelCoreCol, channelRimCol, ionizedEdge * 0.72 + 0.18);

  float filamentGlow = pow(pixVal, 1.38);
  vec3 rebuiltLightning = (pixVal * 0.76 + filamentGlow * 0.68) * lightningCol * (1320.0 * (1.0 + lightningBloomStrength * 0.55));
  return min(max(rebuiltLightning, vec3(0.0)), vec3(5000.0));
}


float saturate(float x) { return min(1.0, max(0.0, x)); }
vec3 saturate(vec3 x) { return min(vec3(1., 1., 1.), max(vec3(0., 0., 0.), x)); }


vec3 bump3y(vec3 x, vec3 yoffset)
{
  vec3 y = vec3(1., 1., 1.) - x * x;
  y = saturate(y - yoffset);
  return y;
}
vec3 spectral_zucconi(float w)
{
  // w: [400, 700] wavelenght(nm)
  // x: [0,   1]
  float x = saturate((w - 400.0) / 300.0);
  const vec3 cs = vec3(3.54541723, 2.86670055, 2.29421995);
  const vec3 xs = vec3(0.69548916, 0.49416934, 0.28269708);
  const vec3 ys = vec3(0.02320775, 0.15936245, 0.53520021);
  return bump3y(cs * (x - xs), ys);
}


vec4 getAirColor(vec2 fragCoordIn)
{
  vec2 bndFragCoord = vec2(fragCoordIn.x, clamp(fragCoordIn.y, 0., resolution.y)); // bound y within range
  base = bilerpWallVis(baseTex, wallTex, bndFragCoord);
  wall = texture(wallTex, bndFragCoord * texelSize);                               // texCoord
  water = bilerpWallVis(waterTex, wallTex, bndFragCoord);
  lightIntensity = texture(lightTex, bndFragCoord * texelSize)[0] / standardSunBrightness;

  ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

  float realTemp = potentialToRealT(base[TEMPERATURE]);

  bool nightTime = abs(sunAngle) > 85.0 * deg2rad; // false = day time

  shadowLight = minShadowLight;

  // fragmentColor = vec4(vec3(light),1); return; // View light texture for debugging

  float cloudwater = water[CLOUD];

  // Cloud visual rework v3: deeper tower depth cues, anvil shear and precipitation curtains.
  float cloudShade = clamp(1.0 / (cloudwater * 0.0036 + 1.0), 0.14, 1.0);

  float cloudBody = max(cloudwater, 0.0);
  float cloudLayerA = smoothstep(0.10, 0.42, texCoord.y) * (0.58 + 0.42 * cloudLayerComplexity);
  float cloudLayerB = smoothstep(0.28, 0.78, texCoord.y) * (0.66 + 0.50 * cloudLayerComplexity);
  float cloudLayerC = smoothstep(0.56, 0.98, texCoord.y) * (0.36 + 0.44 * cloudLayerComplexity);

  vec2 cloudNoiseUv0 = vec2(texCoord.x * resolution.x * 0.007 + iterNum * 0.0018,
                            texCoord.y * resolution.y * 0.012 - iterNum * 0.0014);
  vec2 cloudNoiseUv1 = vec2(texCoord.x * resolution.x * 0.019 - iterNum * 0.0042,
                            texCoord.y * resolution.y * 0.028 + iterNum * 0.0028);
  vec2 cloudNoiseUv2 = vec2(texCoord.x * resolution.x * 0.052 + iterNum * 0.0061,
                            texCoord.y * resolution.y * 0.064 - iterNum * 0.0056);
  float cloudNoiseBroad = texture(noiseTex, cloudNoiseUv0).r;
  float cloudNoiseDetail = texture(noiseTex, cloudNoiseUv1).r;
  float cloudNoiseFine = texture(noiseTex, cloudNoiseUv2).r;
  float cloudNoiseWarp = texture(noiseTex, vec2(texCoord.x * resolution.x * 0.032 + iterNum * 0.0026,
                                                texCoord.y * resolution.y * 0.046 + iterNum * 0.0019)).r;

  float billow = mix(cloudNoiseBroad, cloudNoiseDetail, 0.52);
  float cauliflowerRidge = smoothstep(0.56, 0.98, cloudNoiseFine) * smoothstep(0.18, 0.92, cloudBody);
  float cloudTower = smoothstep(0.20, 0.82, texCoord.y) * smoothstep(0.40, 0.92, cloudNoiseDetail + cloudBody * 0.08);
  float cloudCavity = smoothstep(0.28, 0.86, cloudNoiseWarp) * smoothstep(0.20, 0.80, cloudBody);
  float anvilShear = smoothstep(0.58, 0.97, texCoord.y) * (0.84 + 0.70 * abs(base[VX]));
  float cloudTurret = smoothstep(0.24, 0.84, texCoord.y) * smoothstep(0.64, 0.98, cloudNoiseBroad + cloudNoiseFine * 0.7);
  float entrainment = smoothstep(0.08, 0.42, texCoord.y) * smoothstep(0.45, 0.95, cloudNoiseWarp + cloudNoiseDetail * 0.6);

  float cloudDensity = cloudBody * (7.9 + cloudLayerComplexity * 7.2);
  cloudDensity *= (0.68 + cloudLayerA * 0.36 + cloudLayerB * 0.34 + cloudLayerC * 0.31);
  cloudDensity *= mix(0.62, 1.44, billow);
  cloudDensity *= (1.0 + anvilShear * 0.32 + cauliflowerRidge * 0.30 + cloudTower * 0.28);
  cloudDensity *= (1.0 + cloudTurret * 0.16 + entrainment * 0.14);
  cloudDensity *= mix(0.88, 1.10, cloudCavity);

  float cloudVisualLimiter = 1.0 / (1.0 + max(cloudDensity - 3.8, 0.0) * 0.20);
  cloudDensity *= cloudVisualLimiter;

  float precipMass = max(water[PRECIPITATION], 0.0);
  float precipShaft = clamp(precipMass * (2.35 * precipitationShaftStrength), 0.0, 1.0);
  float precipMist = clamp(precipMass * (1.75 * precipitationMistStrength) + cloudBody * 0.26, 0.0, 1.0);

  vec2 precipNoiseUv = vec2(texCoord.x * resolution.x * 0.040 + iterNum * 0.010,
                            texCoord.y * resolution.y * 0.098 - iterNum * 0.064);
  float streakNoise = texture(noiseTex, precipNoiseUv).r;
  float streakMask = smoothstep(0.54, 1.00, streakNoise + precipShaft * 0.40);
  float shaftEnvelope = smoothstep(0.05, 0.95, texCoord.y) * (1.0 - smoothstep(0.94, 1.0, texCoord.y));
  float verticalCurtain = smoothstep(0.20, 0.92, texCoord.y);
  float precipShaftOpacity = precipShaft * streakMask * shaftEnvelope * verticalCurtain;

  float sparkleNoise = texture(noiseTex, vec2(texCoord.x * resolution.x * 0.125 - iterNum * 0.025,
                                              texCoord.y * resolution.y * 0.185 + iterNum * 0.017)).r;
  float precipSparkleMask = smoothstep(0.76, 1.0, sparkleNoise + precipShaft * 0.30);
  float precipSparkleGlow = precipSparkleMask * precipShaft * precipitationSparkle * 0.72;

  float silverLining = smoothstep(0.40, 0.98, cloudNoiseFine) * smoothstep(0.18, 0.88, cloudBody) * (0.34 + 0.86 * lightIntensity);
  vec3 cloudCoreCol = mix(vec3(0.60, 0.66, 0.74), vec3(0.92, 0.96, 1.0), clamp(cloudShade * 1.20, 0.0, 1.0));
  vec3 cloudShadowCol = vec3(0.27, 0.34, 0.46);
  vec3 precipShaftCol = mix(vec3(0.46, 0.64, 0.96), vec3(0.78, 0.91, 1.0), clamp(precipitationSparkle * 0.8, 0.0, 1.0));
  vec3 precipMistCol = mix(vec3(0.72, 0.80, 0.92), vec3(0.50, 0.61, 0.84), clamp(precipitationMistStrength * 0.78, 0.0, 1.0));

  float cloudContrast = clamp(cloudShade * (0.74 + 0.34 * billow + cloudTower * 0.12), 0.0, 1.0);
  vec3 cloudCol = mix(cloudShadowCol, cloudCoreCol, cloudContrast);
  cloudCol += vec3(0.12, 0.17, 0.26) * silverLining;
  cloudCol += vec3(0.06, 0.09, 0.15) * cloudTurret;
  cloudCol += vec3(0.07, 0.09, 0.12) * cauliflowerRidge;
  cloudCol = mix(cloudCol, cloudShadowCol * 0.85, cloudCavity * 0.22);
  cloudCol = mix(cloudCol, cloudShadowCol * 0.80, entrainment * 0.18);
  cloudCol = mix(cloudCol, precipMistCol, precipMist * 0.52);
  cloudCol += precipShaftCol * (precipShaftOpacity * 0.88 + precipSparkleGlow * 0.24);

  float precipDensity = precipMass * (1.05 * precipitationShaftStrength + 0.76 * precipitationMistStrength);
  float totalDensity = cloudDensity + precipDensity;

  float cloudOpacity = clamp((1.0 - (1.0 / (1.0 + totalDensity))) * (0.95 + 0.24 * precipitationMistStrength), 0.0, 0.98);
  cloudOpacity = max(cloudOpacity, clamp(precipShaftOpacity * 0.62 + precipMist * 0.26, 0.0, 0.86));

  const vec3 smokeThinCol = vec3(0.8, 0.51, 0.26);
  const vec3 smokeThickCol = vec3(0., 0., 0.);


  float smokeOpacity = clamp(1. - (1. / (water[SMOKE] + 1.)), 0.0, 1.0);
  float fireCore = clamp((smokeOpacity - 0.76) * 18., 0.0, 1.0);
  float emberBand = clamp((smokeOpacity - 0.58) * 4.2, 0.0, 1.0) * (1.0 - fireCore * 0.75);
  float fireIntensity = clamp(fireCore + emberBand * 0.55, 0.0, 1.0);

  vec3 fireCoreCol = vec3(1.00, 0.88, 0.62);
  vec3 emberCol = vec3(1.00, 0.38, 0.08);
  vec3 sootGlow = vec3(0.52, 0.14, 0.03);
  vec3 fireCol = mix(emberCol, fireCoreCol, fireCore);
  fireCol = mix(sootGlow, fireCol, clamp(fireIntensity * 1.2, 0.0, 1.0));

  vec3 smokeOrFireCol = mix(mix(smokeThinCol, smokeThickCol, smokeOpacity), fireCol, fireIntensity);

  shadowLight += fireIntensity * 3.1 + emberBand * 0.8;

  float opacity = 1. - (1. - smokeOpacity) * (1. - cloudOpacity);                                                     // alpha blending
  vec3 color = (smokeOrFireCol * smokeOpacity / opacity) + (cloudCol * cloudOpacity * (1. - smokeOpacity) / opacity); // color blending


  vec4 lightningData = texture(lightningDataTex, vec2(0.5));
  vec2 lightningPos = lightningData.xy;
  float lightningStartIterNum = lightningData[START_ITERNUM];

  float lightningTime = calcLightningTime(lightningStartIterNum);
  float lightningSign = lightningData[INTENSITY] < 0.0 ? -1.0 : 1.0;
  float currentLightningIntensity = lightningIntensityOverTime(lightningTime, lightningPos, lightningData[INTENSITY]) * lightningSign;

  if (lightningStartIterNum <= 0.0 || lightningTime > 3.2)
    currentLightningIntensity = 0.0;


  float lightningVisThreshold = mix(0.18, 0.08, clamp((mobileLightningVisibility - 1.0) * 0.85, 0.0, 1.0));
  bool forceMobileBoltRender = mobileLightningVisibility >= 2.0;
  if (forceMobileBoltRender || abs(lightningData[INTENSITY]) > lightningVisThreshold) { // force full bolt structure on mobile, including weaker sampled strikes
    emittedLight += displayLightning(lightningPos, lightningTime, currentLightningIntensity);
    emittedLight /= 1. + cloudDensity * (170.0 / max(lightningBloomStrength, 0.25));
    emittedLight = min(emittedLight, vec3(28000.0));
  }

#define lightningOnLightBrightness 0.0014

  vec2 dist = vec2(lightningPos.x - texCoord.x, max((abs(lightningPos.y / 2. - texCoord.y) - 0.1), 0.));
  dist.x *= aspectRatios[0];
  float lightningOnLight = lightningOnLightBrightness / (pow(length(dist), 2.) + 0.03);
  lightningOnLight *= (1.0 + lightningBloomStrength * 0.45);
  lightningOnLight *= abs(currentLightningIntensity) * (1.0 + lightningBloomStrength * 0.32);

  // Electric field / dynamic charge-separation visualization
  float electricFieldGlow = abs(currentLightningIntensity) * 0.0000042 * lightningBloomStrength / (pow(length(dist), 1.20) + 0.040);
  float chargeGradient = length(vec2(dFdx(water[CLOUD] + water[PRECIPITATION]), dFdy(water[CLOUD] + water[PRECIPITATION])));
  float chargeShear = length(vec2(dFdx(base[VY]), dFdy(base[VX])));
  float chargeSeparation = (chargeGradient * 3.6 + chargeShear * 120.0 + abs(texture(curlTex, texCoord).r) * 2.0) * dynamicChargeSeparation;
  float ambientField = smoothstep(0.05, 0.65, chargeSeparation) * electricFieldVizStrength;
  float fieldDiffused = ambientField / (1.0 + cloudDensity * 0.35 * electricFieldDiffusion);
  vec3 coronaColor = mix(vec3(0.45, 0.65, 1.0), vec3(1.0, 0.85, 0.55), clamp(lightningColorTempMult, 0.0, 1.5));

  onLight += vec3(lightningOnLight) + coronaColor * (electricFieldGlow * electricFieldVizStrength + fieldDiffused * 0.012);
  onLight = min(onLight, vec3(14.0));

  // Rainbow rework: sun-opposed arc with anti-solar center shift and wet-curtain gating.
  float rainRich = clamp(water[PRECIPITATION] * 2.1 + cloudOpacity * 0.42, 0.0, 1.0);
  float sunElevNorm = clamp((sunAngle + 0.24) * 1.08, 0.0, 1.0);
  float antiSolarX = clamp(0.5 - sin(sunAngle) * 0.36, 0.14, 0.86);
  vec2 rainbowCenter = vec2(antiSolarX, 0.10 + sunElevNorm * 0.24);
  vec2 toPix = vec2((texCoord.x - rainbowCenter.x) * aspectRatios[0], texCoord.y - rainbowCenter.y);
  float r = length(toPix);
  float arcHeightMask = 1.0 - smoothstep(0.42, 0.95, texCoord.y);
  float horizonFade = smoothstep(0.02, 0.30, texCoord.y);

  float primaryArcCore = exp(-pow((r - 0.505) / 0.014, 2.0));
  float primaryArcHalo = exp(-pow((r - 0.505) / 0.032, 2.0)) * 0.52;
  float secondaryArc = exp(-pow((r - 0.562) / 0.024, 2.0)) * 0.36;

  float primaryW = map_rangeC(r, 0.485, 0.532, 700.0, 405.0);
  float secondaryW = map_rangeC(r, 0.544, 0.586, 410.0, 700.0);
  vec3 rainbowPrimaryCol = spectral_zucconi(primaryW);
  vec3 rainbowSecondaryCol = spectral_zucconi(secondaryW) * 0.58;

  float rainCurtainMask = smoothstep(0.18, 0.88, water[PRECIPITATION] + water[CLOUD] * 0.22);
  float rainbowMask = (primaryArcCore + primaryArcHalo + secondaryArc) * rainRich * rainCurtainMask * clamp(lightIntensity * 2.2, 0.0, 1.0);
  rainbowMask *= smoothstep(0.03, 0.34, texCoord.y) * arcHeightMask * horizonFade;

  vec3 rainbowLight = rainbowPrimaryCol * (primaryArcCore + primaryArcHalo) + rainbowSecondaryCol * secondaryArc;
  onLight += rainbowLight * rainbowMask * (1.22 * sqrt(ambientScattering));

  return vec4(color, opacity);
}

float rand(float n) { return fract(sin(n) * 43758.5453123); }

void main()
{
  vec2 bndFragCoord = vec2(fragCoord.x, clamp(fragCoord.y, 0., resolution.y)); // bound y within range
  base = bilerpWallVis(baseTex, wallTex, bndFragCoord);
  wall = texture(wallTex, bndFragCoord * texelSize);                           // texCoord
  water = bilerpWallVis(waterTex, wallTex, bndFragCoord);
  lightIntensity = texture(lightTex, bndFragCoord * texelSize)[0] / standardSunBrightness;

  ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

  float realTemp = potentialToRealT(base[TEMPERATURE]);

  bool nightTime = abs(sunAngle) > 85.0 * deg2rad; // false = day time

  shadowLight = minShadowLight;

  // fragmentColor = vec4(vec3(light),1); return; // View light texture for debugging

  float cloudwater = water[CLOUD];

  if (texCoord.y < 0.) {                                     // < texelSize.y below simulation area

    float depth = float(-wall[VERT_DISTANCE]) - fragCoord.y; // -1.0?

    color = getWallColor(depth);

    lightIntensity = texture(lightTex, vec2(texCoord.x, texelSize.y))[0] / standardSunBrightness; // sample lowest part of sim area
    lightIntensity *= pow(0.5, -fragCoord.y);                                                     // 0.5 should be same as in lightingshader deeper is darker

  } else if (texCoord.y > 1.0) {                                                                  // above simulation area
    // color = vec3(0); // no need to set
    opacity = 0.0;                  // completely transparent
  } else if (wall[DISTANCE] == 0) { // is wall
                                    // color = getWallColor(texCoord);

    ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
    ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);

    switch (wall[TYPE]) {
      // case WALLTYPE_INERT:
      //   color = vec3(0, 0, 0);
      //   break;

    case WALLTYPE_RUNWAY:

      if (wall[VERT_DISTANCE] == 0) {
        vec2 modTexCoord = mod(texCoord * resolution, 1.0);

        color = vec3(0.1);
        color *= texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.2).rgb; // add noise texture

        if (length(modTexCoord - vec2(0.7, 0.97)) < 0.03) {                                               // side lights
          onLight += vec3(1., 0.8, 0.3) * 300.0;
        }

        if (abs(mod(-iterNum - floor(texCoord.x * resolution.x), 150.0)) < 1.0 && length(modTexCoord - vec2(0.2, 0.98)) < 0.02) {
          onLight += vec3(0., 1.0, 0.) * 5000.0;
        }

        break;
      }

    case WALLTYPE_URBAN:
    case WALLTYPE_INDUSTRIAL:
    case WALLTYPE_FIRE:
    case WALLTYPE_LAND:

      // horizontally interpolate depth value
      float interpDepth = mix(mix(float(-wallXmY0[VERT_DISTANCE]), float(-wall[VERT_DISTANCE]), clamp(fract(fragCoord.x) + 0.5, 0.5, 1.)), float(-wallXpY0[VERT_DISTANCE]), clamp(fract(fragCoord.x) - 0.5, 0., 0.5));
      float depth = interpDepth - fract(fragCoord.y); // - 1.0 ?

      color = getWallColor(depth);

      break;
    case WALLTYPE_WATER:

      // Precomputed values (tweak to taste)
      // Frequencies
      const int numWaveComp = 5;
      const float freqs[numWaveComp] = float[numWaveComp](2.3, 3.7, 5.1, 7.6, 21.7);
      // Amplitudes
      const float amps[numWaveComp] = float[numWaveComp](0.05, 0.03, 0.02, 0.015, 0.004);
      // Speeds
      const float speeds[numWaveComp] = float[numWaveComp](0.006, 0.011, 0.018, 0.025, 0.05);
      // Phases (in radians)
      const float phases[numWaveComp] = float[numWaveComp](1.2, 3.9, 0.7, 5.1, 3.1);

      // Sum up the components
      float waveSignalL = 0.0;
      float waveSignalR = 0.0;

      for (int i = 0; i < numWaveComp; i++) {
        waveSignalL += sin(fragCoord.x * freqs[i] + iterNum * speeds[i] + phases[i]) * amps[i];
        waveSignalR += sin(fragCoord.x * freqs[i] - iterNum * speeds[i] + phases[i]) * amps[i];
      }

      vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);
      float windSpeed = baseX0Yp[VX] * 10.;
      float precipChop = clamp(water[PRECIPITATION] * 0.7 + abs(baseX0Yp[VY]) * 18.0, 0.0, 1.4);
      float swell = 1.0 + precipChop * 0.35 + abs(windSpeed) * 0.05;

      // combine based on wind direction
      float waterLevel = 0.8 + (waveSignalL * max(-windSpeed, 0.) + waveSignalR * max(windSpeed, 0.)) * swell;

      if (wall[VERT_DISTANCE] == 0 && fract(fragCoord.y) > waterLevel) { // air
        vec4 airColor = getAirColor(fragCoord + vec2(0., 0.5));

        opacity = airColor.a;
        color = airColor.rgb;
      } else {
        color = vec3(0, 0.5, 1.0); // water
      }

      // draw 45° slopes under water

      float localX = fract(fragCoord.x);
      float localY = fract(fragCoord.y);

      if (wallXmY0[DISTANCE] == 0 && wallXmY0[TYPE] != WALLTYPE_WATER && (fragCoord.y < 1. || wallX0Ym[TYPE] != WALLTYPE_WATER)) { // wall to the left and below
        if (localX + localY < 1.0) {
          opacity = 1.0;
          water = texture(waterTex, texCoord);
          color = getWallColor(float(-wall[VERT_DISTANCE]) - localY);
          shadowLight = minShadowLight;
        }
      }
      if (wallXpY0[DISTANCE] == 0 && wallXpY0[TYPE] != WALLTYPE_WATER && (fragCoord.y < 1. || wallX0Ym[TYPE] != WALLTYPE_WATER)) { // wall to the right and below
        if (localY - localX < 0.0) {
          opacity = 1.0;
          water = texture(waterTex, texCoord);
          color = getWallColor(float(-wall[VERT_DISTANCE]) - localY);
          shadowLight = minShadowLight;
        }
      }

      break;
    }
  } else { // air

    vec4 airColor = getAirColor(fragCoord);

    opacity = airColor.a;
    color = airColor.rgb;


    vec2 rainbowCenter = vec2(0.0, -1.5 + abs(sunAngle) * 0.60);

    float centerDist = length(onScreenUV - rainbowCenter) * 1.3;

    const float cameraHeight = 1.0;

    float angle = atan(centerDist / cameraHeight) * rad2deg;

    float waveLength = map_range(angle, 40.0, 42.0, 400., 700.);

    float rainSnowFactor = map_rangeC(KtoC(realTemp), 0.0, 5.0, 0.0, 1.0); // only rain if above freezing

    vec3 rainbowCol = spectral_zucconi(waveLength) * min(pow(lightIntensity, 2.0) * 1.6, 1.0) * min(water[PRECIPITATION] * 2.1, 1.0) * rainSnowFactor * 0.32;

    emittedLight += rainbowCol;
    opacity = max(opacity - length(rainbowCol) * 0.45, 0.);


    if (wall[VERT_DISTANCE] >= 0 && wall[VERT_DISTANCE] < 10) { // near surface
      float localX = fract(fragCoord.x);
      float localY = fract(fragCoord.y);
      // ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

#define texAspect 2560. / 4096. // height / width of tree texture
#define maxTreeHeight 40.       // height in meters when vegetation max = 127
#define maxBuildingHeight 400.  // height in meters upto wich the urban texture reaches


      if (wallX0Ym[TYPE] == WALLTYPE_URBAN) {

        float heightAboveGround = localY + float(wall[VERT_DISTANCE] - 1);

        float urbanTexHeightNorm = maxBuildingHeight / cellHeight; // example: 200 / 40 = 5

        float urbanTexCoordX = mod(fragCoord.x, resolution.x) * texAspect / urbanTexHeightNorm;
        float urbanTexCoordY = heightAboveGround / urbanTexHeightNorm;

        // urbanTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // building height

        urbanTexCoordY = 1.0 - urbanTexCoordY;

        vec4 texCol = surfaceTexture(URBAN, vec2(urbanTexCoordX, urbanTexCoordY));
        if (texCol.a > 0.5) { // if not transparent

          if (nightTime) {
            shadowLight = 1.0;                 // city lights
            texCol.rgb *= vec3(1.0, 0.8, 0.5); // yellowish windows
          } else {                             // day time
            texCol.rgb *= vec3(0.8, 0.9, 1.0); // Blueish windows

            if (length(texCol.rgb) < 0.1)
              texCol.rgb = texture(noiseTex, fragCoord * 0.3).rgb * 0.3;
          }
          color = texCol.rgb;
          opacity = texCol.a;
        }
      } else if (wallX0Ym[TYPE] == WALLTYPE_INDUSTRIAL) {

        float heightAboveGround = localY + float(wall[VERT_DISTANCE] - 1);

        float urbanTexHeightNorm = maxBuildingHeight / cellHeight; // example: 200 / 40 = 5

        float urbanTexCoordX = mod(fragCoord.x, resolution.x) * texAspect / urbanTexHeightNorm;
        float urbanTexCoordY = heightAboveGround / urbanTexHeightNorm;

        // urbanTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // building height

        urbanTexCoordY = 1.0 - urbanTexCoordY;

        vec4 texCol = surfaceTexture(INDUS, vec2(urbanTexCoordX, urbanTexCoordY));
        if (texCol.a > 0.5) { // if not transparent

          if (nightTime) {
            shadowLight = 1.0;                 // city lights
            texCol.rgb *= vec3(1.0, 0.8, 0.5); // yellowish windows
          } else {                             // day time
            texCol.rgb *= vec3(0.8, 0.9, 1.0); // Blueish windows

            if (length(texCol.rgb) < 0.1)
              texCol.rgb = texture(noiseTex, fragCoord * 0.3).rgb * 0.3;
          }
          color = texCol.rgb;
          opacity = texCol.a;
        }
      }


      if (wall[VERT_DISTANCE] == 1) {                                                 // 1 above surface
                                                                                      //  if (wallX0Ym[VERT_DISTANCE] == 0) {

        float treeTexHeightNorm = maxTreeHeight / cellHeight;                         // example: 40 / 120 = 0.333

        float treeTexCoordY = localY / treeTexHeightNorm;                             // full height trees

        treeTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // apply trees height depending on vegetation

        float treeTexCoordX = fragCoord.x * texAspect / treeTexHeightNorm;            // static scaled trees

        float heightAboveGround = localY / treeTexHeightNorm;

        treeTexCoordX -= base.x * heightAboveGround * 1.00; // 2.5  trees waving with the wind effect

        treeTexCoordX *= 0.72;                              // Trees only go up to 72% of the texture height
        treeTexCoordY *= 0.72;                              // Trees only go up to 72% of the texture height
        treeTexCoordY = 1. - treeTexCoordY;                 // texture is upside down

        vec4 texCol;
        if (wallX0Ym[TYPE] == WALLTYPE_LAND || wallX0Ym[TYPE] == WALLTYPE_URBAN) { // land below
          vec4 surfaceWater = texture(waterTex, texCoordX0Ym);                     // snow on land below
          float snow = surfaceWater[SNOW];
          if (snow * 0.01 / cellHeight > heightAboveGround)
            texCol = vec4(vec3(1.), 1.);                                                                                                                          // show white snow layer above ground
          else {                                                                                                                                                  // display vegetation
            vec4 treeColor = surfaceTexture(FOREST, vec2(treeTexCoordX, treeTexCoordY));
            vec4 vegetationCol = mix(treeColor, vec4(dryGrassCol, 1.), max(0.5 - surfaceWater[SOIL_MOISTURE] * (0.5 / fullGreenSoilMoisture), 0.) * treeColor.a); // green to brown
            texCol = mix(vegetationCol, surfaceTexture(SNOW_FOREST, vec2(treeTexCoordX, treeTexCoordY)), min(snow / fullWhiteSnowHeight, 1.0));
          }
        } else if (wallX0Ym[TYPE] == WALLTYPE_FIRE) {
          texCol = surfaceTexture(FIRE_FOREST, vec2(treeTexCoordX, treeTexCoordY));
        }
        if (texCol.a > 0.5) { // if not transparent
          color = texCol.rgb;

          shadowLight = minShadowLight;        // make sure trees are dark at night

          if (wallX0Ym[TYPE] == WALLTYPE_FIRE) // fire below
            shadowLight = 1.0;

          opacity = 1. - (1. - opacity) * (1. - texCol.a); // alpha blending
        }

        // draw 45° slopes
        ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
        ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);

        if (wallXmY0[DISTANCE] == 0 && wall[TYPE] != WALLTYPE_WATER) { // wall to the left and below
          if (localX + localY < 1.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(localY - 0.6);
            shadowLight = minShadowLight; // fire should not light ground
          }
        }
        if (wallXpY0[DISTANCE] == 0 && wall[TYPE] != WALLTYPE_WATER) { // wall to the right and below
          if (localY - localX < 0.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(localY - 0.6);
            shadowLight = minShadowLight; // fire should not light ground
          }
        }
      }
    }
    float arrow = vectorField(base.xy, displayVectorField);

    if (arrow > 0.5) {
      fragmentColor = vec4(vec3(1., 1., 0.), 1.);
      return; // exit shader
    }

    // color.rg += vec2(arrow);
    // color.b -= arrow;
    // opacity += arrow;
    // lightIntensity += arrow;
  }


  float scatering = clamp(map_range(abs(sunAngle), 75. * deg2rad, 90. * deg2rad, 0., 1.), 0., 1.); // how red the sunlight is

  vec3 finalLight = sunColor(scatering) * lightIntensity;


  if (fract(cursor.w) > 0.5) {                                               // enable flashlight
    vec2 vecFromMouse = cursor.xy - texCoord;
    vecFromMouse.x *= texelSize.y / texelSize.x;                             // aspect ratio correction to make it a circle
    float rangeScaledDist = length(vecFromMouse) * (5.0 / max(flashlightRange, 0.2));
    float focusedCone = pow(max(cos(min(rangeScaledDist, 2.6)), 0.0), max(flashlightFocus * 1.8, 0.25));
    float volumetricScatter = exp(-rangeScaledDist * 1.35) * (0.10 + water[SMOKE] * 0.04 + water[PRECIPITATION] * 0.06);
    shadowLight += focusedCone * flashlightIntensity;
    onLight += vec3(0.58, 0.68, 0.95) * volumetricScatter * flashlightIntensity * 0.85;
  }

  vec3 ambientLight = texture(ambientLightTex, texCoord).rgb;

  onLight += ambientLight * pow(1. - clamp(-texCoord.y * 15., 0., 1.), 2.5) * ambientScattering * radiationHaze;

  float twilightScatter = clamp(map_range(abs(sunAngle), 60. * deg2rad, 92. * deg2rad, 0.0, 1.0), 0.0, 1.0);
  onLight += vec3(0.42, 0.53, 0.75) * twilightScatter * 0.22 * ambientScattering;

  float sceneCloudOpacity = clamp(1.0 - (1.0 / (1.0 + max(water[CLOUD], 0.0) * (6.0 + cloudLayerComplexity * 4.0) + water[PRECIPITATION] * 0.8)), 0.0, 1.0);
  float cloudShadowRay = clamp(cloudLayerComplexity * 0.18 * (1.0 - sceneCloudOpacity), 0.0, 0.22);
  finalLight += vec3(shadowLight + cloudShadowRay) + onLight;

  // Render lightning rods as tall metallic masts near surface (optional visual only).
  if (showLightningRods == 1)
  for (int r = 0; r < 8; r++) {
    if (r >= lightningRodCount)
      break;
    vec2 rod = lightningRodPos[r];
    float dx = abs(texCoord.x - rod.x);
    dx = min(dx, 1.0 - dx) * aspectRatios[0];
    float mastHeight = 0.16;
    float mastTop = rod.y + mastHeight;
    if (dx < 0.0018 && texCoord.y >= rod.y && texCoord.y <= mastTop) {
      vec3 metal = vec3(0.72, 0.78, 0.84);
      color = mix(color, metal, 0.88);
      shadowLight += 0.22;
      opacity = 1.0;
    }
    if (distance(vec2(dx, texCoord.y - mastTop), vec2(0.0)) < 0.0035) {
      color = mix(color, vec3(0.86, 0.90, 0.94), 0.92);
      onLight += vec3(0.08, 0.12, 0.16);
      opacity = 1.0;
    }
  }

  opacity += length(emittedLight);
  opacity = clamp(opacity, 0.0, 1.0);
  fragmentColor = vec4(max(color * finalLight, 0.) + emittedLight, opacity);

  drawCursor(cursor, view); // over everything else
}
