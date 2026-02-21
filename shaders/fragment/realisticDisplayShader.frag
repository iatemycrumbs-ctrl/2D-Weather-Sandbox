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
uniform float precipitationVisualBoost;
uniform float precipitationTint;
uniform float precipitationContrast;
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
    const vec3 rockCol = vec3(0.70);
    color = mix(surfCol, rockCol, clamp(depth * 0.35, 0.0, 1.0));
  }

  color *= mix(vec3(0.88), vec3(1.12), texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.20).rgb);
  color = mix(color, vec3(1.0), clamp(min(water[SNOW], fullWhiteSnowHeight) / fullWhiteSnowHeight - max(depth * 0.3, 0.0), 0.0, 1.0));

  return color;
}

const vec2 lightningTexRes = vec2(2500, 5000);
const float lightningTexAspect = lightningTexRes.x / lightningTexRes.y;

float calcLightningTime(float startIterNum)
{
  float lightningTime = iterNum - startIterNum;
  return lightningTime / (2.95 * lightningFlashPersistence);
}

float lightningChannelEnvelope(float T, bool isIC)
{
  float rise = 1.0 - exp(-T * (isIC ? 9.8 : 11.3));
  float fastDecay = exp(-T * (isIC ? 2.6 : 3.0));
  float slowDecay = exp(-T * (isIC ? 0.95 : 1.05));
  float envelope = fastDecay * 0.78 + slowDecay * 0.22;
  return rise * envelope * (isIC ? 2.0 : 2.5);
}

vec2 lightningWarpOffset(vec2 uv, float lightningTime, vec2 seed, float strikeTypeSign)
{
  float axis = strikeTypeSign < 0.0 ? uv.x : uv.y;
  float meander = sin(axis * 34.0 + lightningTime * 2.1 + random2d(seed * 17.1) * 6.2831) * 0.0085;
  meander += sin(axis * 82.0 + lightningTime * 1.5 + random2d(seed * 7.3) * 6.2831) * 0.0035;
  float filament = sin((axis * 120.0 + lightningTime * 7.0) + (strikeTypeSign < 0.0 ? uv.y : uv.x) * 19.0) * 0.0016;
  if (strikeTypeSign < 0.0)
    return vec2(0.0, (meander + filament) * 0.45);
  return vec2(meander + filament, 0.0);
}

float lightningIntensityOverTime(float Tin, vec2 lightningPos, float intensity)
{
  bool isIC = intensity < 0.0;
  float absIntensity = abs(intensity);
  float T = max(Tin, 0.0);

  float channelEnvelope = lightningChannelEnvelope(T, isIC);

  // Stable low-frequency flicker to avoid continuous harsh strobing.
  float phase = random2d(lightningPos * 9.17) * 6.2831;
  float flicker = 0.99 + 0.01 * sin(T * (isIC ? 3.1 : 2.3) + phase);

  return channelEnvelope * max(flicker, 0.90) * pow(absIntensity, 1.50);
}

vec3 displayLightning(vec2 pos, float lightningTime, float currentLightningIntensity)
{
  float signedIntensity = currentLightningIntensity;
  float strikeTypeSign = signedIntensity < 0.0 ? -1.0 : 1.0; // <0 IC, >0 CG
  currentLightningIntensity = abs(currentLightningIntensity);
  vec2 lightningTexCoord = texCoord;

  lightningTexCoord.x -= mod(pos.x, 1.0);
  lightningTexCoord.y -= pos.y;

  bool upwardGroundArc = strikeTypeSign > 0.0 && pos.y < 0.14;
  float anchorY = strikeTypeSign < 0.0 ? max(pos.y + 0.18, 0.25) : max(pos.y, 0.05);
  float scaleMult = 1.0 / anchorY;
  if (strikeTypeSign < 0.0)
    scaleMult *= 0.72;

  lightningTexCoord.x *= scaleMult * aspectRatios[0] / lightningTexAspect;
  lightningTexCoord.y *= upwardGroundArc ? scaleMult : -scaleMult;
  lightningTexCoord.x += 0.5;

  if (strikeTypeSign < 0.0) {
    vec2 icSwap = lightningTexCoord;
    lightningTexCoord.x = icSwap.y * 0.90 + 0.5;
    lightningTexCoord.y = (icSwap.x - 0.5) * 0.95 + 0.46;
  }

  if (lightningTexCoord.x < -0.58 || lightningTexCoord.x > 1.60 || lightningTexCoord.y < -0.58 || lightningTexCoord.y > 1.68)
    return vec3(0.0);

  // Channel model: texture-guided trunk + procedural meander + IC horizontal sweep.
  lightningTexCoord += lightningWarpOffset(lightningTexCoord, lightningTime, pos, strikeTypeSign);

  float trunk = texture(lightningTex, lightningTexCoord).r;
  vec2 px = vec2(1.0 / lightningTexRes.x, 1.0 / lightningTexRes.y);
  float side = max(texture(lightningTex, lightningTexCoord + vec2(px.x, 0.0)).r,
                   texture(lightningTex, lightningTexCoord - vec2(px.x, 0.0)).r);
  float upDown = max(texture(lightningTex, lightningTexCoord + vec2(0.0, px.y)).r,
                     texture(lightningTex, lightningTexCoord - vec2(0.0, px.y)).r);
  float pixVal = max(trunk, max(side, upDown) * (0.50 + 0.22 * lightningBloomStrength));
  float branchGhost = texture(lightningTex, lightningTexCoord + vec2(px.x * 2.0, -px.y * 3.0)).r;
  branchGhost = max(branchGhost, texture(lightningTex, lightningTexCoord + vec2(-px.x * 2.5, -px.y * 4.0)).r);
  pixVal += branchGhost * (strikeTypeSign < 0.0 ? 0.42 : 0.30);

  if (strikeTypeSign < 0.0) {
    float icEnvelope = smoothstep(-0.30, -0.02, lightningTexCoord.y) * (1.0 - smoothstep(0.36, 0.86, lightningTexCoord.y));
    pixVal *= clamp(icEnvelope, 0.0, 1.0);
  }

  const float branchShowFactor = 1.3;
  float branchAxis = strikeTypeSign < 0.0 ? abs(lightningTexCoord.x - 0.5) * 1.4 : lightningTexCoord.y;
  float fadeProgress = smoothstep(0.02, 1.35, lightningTime);
  float brightnessThreshold = mix(0.05 + branchAxis * 0.28, strikeTypeSign < 0.0 ? 0.68 : 0.60, fadeProgress * branchShowFactor);

  pixVal = max(pixVal - brightnessThreshold, 0.0);
  pixVal *= mix(84000.0, 154000.0, strikeTypeSign > 0.0 ? 1.0 : 0.52);

  float lightningTemp = map_rangeC(currentLightningIntensity, 20000.0, 2600000.0, lightningTempMinK, lightningTempMaxK);
  float thermalColorMix = map_rangeC(lightningTemp, lightningTempMinK, lightningTempMaxK, 0.0, 1.0) * lightningColorTempMult;
  vec3 coolLightningCol = strikeTypeSign < 0.0 ? vec3(0.52, 0.66, 1.0) : vec3(0.70, 0.60, 1.0);
  vec3 hotLightningCol = strikeTypeSign < 0.0 ? vec3(0.82, 0.93, 1.00) : vec3(1.00, 0.93, 0.78);
  vec3 lightningCol = mix(coolLightningCol, hotLightningCol, clamp(thermalColorMix, 0.0, 1.0));

  float strikeContrast = strikeTypeSign < 0.0 ? 0.82 : 1.08;
  return max(pixVal * lightningCol * strikeContrast, vec3(0.0));
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

  float cloudShade = clamp(1.0 / (cloudwater * 0.0046 + 1.0), 0.18, 1.0);
  float precipPresence = clamp(water[PRECIPITATION] * 2.2 * precipitationVisualBoost, 0.0, 1.0);
  vec3 precipTintCol = mix(vec3(0.88, 0.92, 1.0), vec3(0.62, 0.74, 1.0), clamp(precipitationTint, 0.0, 2.0));
  vec3 cloudCol = mix(vec3(cloudShade), precipTintCol * cloudShade, precipPresence * 0.55);

  float cloudDensity = max(cloudwater * (8.8 + cloudLayerComplexity * 4.4), 0.0);
  float cloudLayerA = smoothstep(0.18, 0.52, texCoord.y) * cloudLayerComplexity;
  float cloudLayerB = smoothstep(0.48, 0.86, texCoord.y) * (0.65 + 0.35 * cloudLayerComplexity);
  float cloudLayerC = smoothstep(0.70, 0.97, texCoord.y) * (0.45 + cloudLayerComplexity * 0.25);
  cloudDensity *= (0.80 + cloudLayerA * 0.30 + cloudLayerB * 0.24 + cloudLayerC * 0.18);

  // Keep rendered cloud opacity bounded even during extreme cloud-water bursts.
  float cloudVisualLimiter = 1.0 / (1.0 + max(cloudDensity - 2.8, 0.0) * 0.26);
  cloudDensity *= cloudVisualLimiter;

  float totalDensity = cloudDensity + water[PRECIPITATION] * (0.8 * precipitationVisualBoost); // visualize precipitation


  // float cloudOpacity = clamp(cloudwater * 4.0, 0.0, 1.0);
  float cloudOpacity = clamp((1.0 - (1.0 / (1. + totalDensity))) * mix(0.82, 1.16, clamp(precipitationContrast, 0.5, 1.8) - 0.5), 0.0, 0.92);

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


  float lightningVisThreshold = mix(0.18, 0.08, clamp((mobileLightningVisibility - 1.0) * 0.85, 0.0, 1.0));
  bool forceMobileBoltRender = mobileLightningVisibility >= 2.0;
  if (forceMobileBoltRender || abs(lightningData[INTENSITY]) > lightningVisThreshold) { // force full bolt structure on mobile, including weaker sampled strikes
    emittedLight += displayLightning(lightningPos, lightningTime, currentLightningIntensity);
    emittedLight /= 1. + cloudDensity * (125.0 / max(lightningBloomStrength, 0.25));
  }

#define lightningOnLightBrightness 0.004 // 0.002

  vec2 dist = vec2(lightningPos.x - texCoord.x, max((abs(lightningPos.y / 2. - texCoord.y) - 0.1), 0.));
  dist.x *= aspectRatios[0];
  float lightningOnLight = lightningOnLightBrightness / (pow(length(dist), 2.) + 0.03);
  lightningOnLight *= abs(currentLightningIntensity);

  // Electric field / dynamic charge-separation visualization
  float electricFieldGlow = abs(currentLightningIntensity) * 0.0000035 * lightningBloomStrength / (pow(length(dist), 1.25) + 0.045);
  float chargeGradient = length(vec2(dFdx(water[CLOUD] + water[PRECIPITATION]), dFdy(water[CLOUD] + water[PRECIPITATION])));
  float chargeShear = length(vec2(dFdx(base[VY]), dFdy(base[VX])));
  float chargeSeparation = (chargeGradient * 3.6 + chargeShear * 120.0 + abs(texture(curlTex, texCoord).r) * 2.0) * dynamicChargeSeparation;
  float ambientField = smoothstep(0.05, 0.65, chargeSeparation) * electricFieldVizStrength;
  float fieldDiffused = ambientField / (1.0 + cloudDensity * 0.35 * electricFieldDiffusion);
  vec3 coronaColor = mix(vec3(0.45, 0.65, 1.0), vec3(1.0, 0.85, 0.55), clamp(lightningColorTempMult, 0.0, 1.5));

  onLight += vec3(lightningOnLight) + coronaColor * (electricFieldGlow * electricFieldVizStrength + fieldDiffused * 0.018);

  // Reworked rainbow: primary + faint secondary arc opposite the sun with horizon and rain gating.
  float rainRich = clamp(water[PRECIPITATION] * 2.4 + cloudOpacity * 0.5, 0.0, 1.0);
  float sunElevNorm = clamp((sunAngle + 0.22) * 1.15, 0.0, 1.0);
  vec2 rainbowCenter = vec2(0.5, 0.12 + sunElevNorm * 0.26);
  vec2 toPix = vec2((texCoord.x - rainbowCenter.x) * aspectRatios[0], texCoord.y - rainbowCenter.y);
  float r = length(toPix);
  float primaryArc = exp(-pow((r - 0.515) / 0.017, 2.0));
  float secondaryArc = exp(-pow((r - 0.565) / 0.024, 2.0)) * 0.42;

  float primaryW = map_rangeC(r, 0.495, 0.535, 700.0, 410.0);
  float secondaryW = map_rangeC(r, 0.545, 0.585, 410.0, 700.0);
  vec3 rainbowPrimaryCol = spectral_zucconi(primaryW);
  vec3 rainbowSecondaryCol = spectral_zucconi(secondaryW) * 0.65;

  float rainbowMask = (primaryArc + secondaryArc) * rainRich * clamp(lightIntensity * 2.3, 0.0, 1.0);
  rainbowMask *= smoothstep(0.03, 0.32, texCoord.y);
  onLight += (rainbowPrimaryCol * primaryArc + rainbowSecondaryCol * secondaryArc) * rainbowMask * (1.15 * sqrt(ambientScattering));

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
