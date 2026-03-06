#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;
in vec2 texCoord;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform vec2 aspectRatios;

uniform sampler2D lightTex;
uniform sampler2D planeTex;
uniform sampler2D planeGearTex;

uniform sampler2D ambientLightTex;

uniform float minShadowLight;
uniform float sunAngle;

uniform float iterNum;
uniform float birdFlockAmount;

uniform float simHeight;

uniform vec2 planeDirectionAndGearPos;

uniform vec3 planePos;

out vec4 fragmentColor;

float light;

vec3 ambientLight;

const float dryLapse = 0.; // definition needed for common.glsl
#include "common.glsl"

#include "commonDisplay.glsl"



float birdWingShape(vec2 p)
{
  float body = smoothstep(0.020, 0.0, length(p * vec2(1.0, 1.6)));
  float wingL = smoothstep(0.040, 0.0, length((p - vec2(-0.040, 0.0)) * vec2(1.0, 2.4)));
  float wingR = smoothstep(0.040, 0.0, length((p - vec2(0.040, 0.0)) * vec2(1.0, 2.4)));
  return max(body, max(wingL, wingR));
}

float birdFlockField(vec2 uv, float t)
{
  float flock = 0.0;
  float activity = clamp(birdFlockAmount, 0.0, 1.8);
  const int BIRD_COUNT = 14;
  for (int i = 0; i < BIRD_COUNT; i++) {
    float fi = float(i);
    float lane = fract(fi * 0.17 + 0.19);
    float speed = 0.020 + lane * 0.015;
    float x = mod(0.08 + fi * 0.077 + t * speed, 1.35) - 0.17;
    float yBase = 0.66 + lane * 0.22;
    float y = yBase + sin(t * (0.95 + lane * 0.7) + fi * 1.31) * (0.010 + lane * 0.018);

    vec2 p = uv - vec2(x, y);
    p.x *= aspectRatios.x;
    float wingFlap = sin(t * (16.0 + lane * 7.0) + fi * 2.5) * (0.010 + lane * 0.010);
    p.y += wingFlap;
    p *= 1.0 + lane * 0.35;

    float bird = birdWingShape(p) * (1.0 - lane * 0.42);
    flock += bird;
  }
  return flock * activity * 0.75;
}

vec4 displayA380(vec2 pos, float angle, out vec3 emittedLight, out vec3 onLight)
{
  vec2 planeTexCoord = texCoord;

  bool planeDir = planeDirectionAndGearPos[0] == 1.; // true = left, false = right

  planeTexCoord.x -= mod(pos.x, 1.);
  // planeTexCoord.x = realMod(planeTexCoord.x, 1.0);
  planeTexCoord.y -= pos.y;
  float cellHeight = simHeight / resolution.y;

  float scaleMult = 60.0 / cellHeight; // 6000

  planeTexCoord.x *= scaleMult * aspectRatios.x;
  planeTexCoord.y *= -scaleMult;

  // planeTexCoord.y -= 0.7;

  // rotate

  float sin_factor = sin(angle);
  float cos_factor = cos(angle);

  planeTexCoord = vec2(planeTexCoord.x, planeTexCoord.y) * mat2(cos_factor, sin_factor, -sin_factor, cos_factor);

  planeTexCoord *= 0.15;              // scale
  planeTexCoord *= vec2(500., 1000.); // Aspect ratio

  planeTexCoord += vec2(0.5, 0.6);    // center rotation point


  if (planeTexCoord.x < 0.01 || planeTexCoord.x > 1.01 || planeTexCoord.y < 0.01 || planeTexCoord.y > 1.01) // prevent edge effect when mipmapping
    return vec4(0);

  vec2 gearTexCoord = vec2(planeDir ? planeTexCoord.x - 0.10 : 0.90 - planeTexCoord.x, (planeTexCoord.y - 0.46 + planeDirectionAndGearPos[1] * 0.01)) * 2.0;

  vec4 outputCol = texture(planeTex, planeTexCoord);

  vec2 planeFragCoord = planeTexCoord * vec2(1000., 500.);

  float T = mod(iterNum, 60.) / 60.;

  emittedLight += (planeDir ? vec3(1., 0.18, 0.10) : vec3(0.10, 0.95, 0.30)) * 7. * max(3.5 - length(planeFragCoord - vec2(planeDir ? 611. : 391., 287.)), 0.);      // wing red/green continuous light
  emittedLight += vec3(0.88, 0.93, 1.0) * 7. * max(3.4 - length(planeFragCoord - vec2(planeDir ? 861. : 138., 286.)), 0.);                                      // Tail white continuous light

  emittedLight += vec3(1., 0., 0.) * 20. * max(7. - length(planeFragCoord - vec2(planeDir ? 341. : 659., 256.)), 0.) * ((T > 0.5 && T < 0.55) ? 1. : 0.); // red beacon light top

  emittedLight += vec3(1., 0., 0.) * 10. * max(5. - length(planeFragCoord - vec2(planeDir ? 460. : 540., 347.)), 0.) * ((T > 0.5 && T < 0.55) ? 1. : 0.); // red beacon light bottem

  emittedLight +=
    vec3(0.50, 0.65, 1.) * 30. * max(7. - length(planeFragCoord - vec2(planeDir ? 611. : 387., 287.)), 0.) * (((T > 0.0 && T < 0.05) || (T > 0.10 && T < 0.15)) ? 1. : 0.); // white wing beacon light

  emittedLight += vec3(1., 1., 1.) * 20. * max(7. - length(planeFragCoord - vec2(planeDir ? 861. : 138., 286.)), 0.) * ((T > 0.0 && T < 0.05) ? 1. : 0.);                   // Tail white beacon light


  float planeCenterLight = texture(lightTex, pos)[0]; // W/m2

  if (planeCenterLight < 100.0) {                     // if dark

                                                      // logo lights:
    onLight += vec3(1., 1., 1.) * (1. - smoothstep(0.0, 130.0, length(planeFragCoord - vec2(planeDir ? 800. : 210., 170.)))); // Tail logo

    // landing lights:
    if (planeDirectionAndGearPos[1] < 2.0) {                                                                                   // gear extended
      emittedLight += vec3(0.8, 0.9, 1.0) * 30. * max(3. - length((planeFragCoord - vec2(planeDir ? 170. : 836., 350.))), 0.); // Front gear landing light

      emittedLight += vec3(0.8, 0.9, 1.0) * 30. * max(3. - length((planeFragCoord - vec2(planeDir ? 336. : 660., 323.))), 0.); // Wing landing light

      onLight += vec3(1., 1., 1.) * 0.9 * (1. - smoothstep(0.0, 150.0, length(planeFragCoord - vec2(planeDir ? 220. : 770., 400.))));
    }
  }

  if (outputCol.a < 0.5)
    outputCol += texture(planeGearTex, gearTexCoord);

  onLight *= outputCol.a; // only shine on plane itself
  return outputCol;
}


void main()
{
  vec2 lightTexCoord = vec2(texCoord.x, min(texCoord.y + texelSize.y * 0.5, 1.0 - texelSize.y)); // limit vertical sample position to top of simulation

  light = texture(lightTex, lightTexCoord)[0] / standardSunBrightness;
  ambientLight = texture(ambientLightTex, texCoord).rgb;

  // vec3 topBackgroundCol = vec3(0.0, 0.0, 0.0);      // 0.15 dark blue
  // vec3 bottemBackgroundCol = vec3(0.20, 0.66, 1.0); // vec3(0.35, 0.58, 0.80) milky white blue
  // vec3 bottemBackgroundCol = vec3(0.40, 0.76, 1.0); // vec3(0.35, 0.58, 0.80) milky white blue

  // vec3 mixedCol = mix(bottemBackgroundCol, topBackgroundCol, clamp(pow(texCoord.y * 0.35, 0.5), 0., 1.)); // 0.2

  // vec3 mixedCol = mix(bottemBackgroundCol, topBackgroundCol, clamp(texCoord.y, 0., 1.)); // 0.2


  float hue = 0.6;
  float sat = map_rangeC(texCoord.y, 0., 2.5, 0.7, 1.0); // more blue at the top


  float val = pow(map_rangeC(texCoord.y, 0., 3.2, 1.0, 0.05), 5.0); // pow 5 map 1.0 to 0.1

  vec3 mixedCol = hsv2rgb(vec3(hue, sat, val));                     // blue air

  vec3 airplaneLights;

  vec3 airplaneOnLight;

  vec4 A380Col = displayA380(planePos.xy, planePos.z, airplaneLights, airplaneOnLight);

  mixedCol *= 1.0 - A380Col.a;
  mixedCol += A380Col.rgb * A380Col.a;

  vec3 finalColor = mixedCol * (light + minShadowLight + airplaneOnLight);

  float airDensityFactor = clamp(1.0 - texCoord.y, 0., 1.);

  finalColor += ambientLight * 0.1 * airDensityFactor / standardSunBrightness;

  finalColor += airplaneLights;

  // Reworked sun + moon with coronas and phase shading.
  vec2 skyCenterSun = vec2(0.5 - sin(sunAngle) * 0.42, 0.58 + cos(sunAngle) * 0.20);
  vec2 skyCenterMoon = vec2(0.5 + sin(sunAngle) * 0.42, 0.58 - cos(sunAngle) * 0.20);
  vec2 dSun = vec2((texCoord.x - skyCenterSun.x) * aspectRatios.x, texCoord.y - skyCenterSun.y);
  vec2 dMoon = vec2((texCoord.x - skyCenterMoon.x) * aspectRatios.x, texCoord.y - skyCenterMoon.y);
  float sunDist = length(dSun);
  float moonDist = length(dMoon);

  float sunDisc = exp(-pow(sunDist / 0.043, 2.0));
  float sunCorona = exp(-pow(sunDist / 0.14, 2.0)) * 0.55;
  float nightFactor = clamp(map_range(abs(sunAngle), 70.0 * deg2rad, 96.0 * deg2rad, 0.0, 1.0), 0.0, 1.0);
  finalColor += vec3(1.00, 0.88, 0.66) * sunDisc * (0.45 + light * 0.8);
  finalColor += vec3(1.00, 0.62, 0.24) * sunCorona * (0.20 + light * 0.35);

  float moonDisc = exp(-pow(moonDist / 0.030, 2.0));
  float moonGlow = exp(-pow(moonDist / 0.11, 2.0)) * 0.34;
  float moonPhase = 0.5 + 0.5 * sin(iterNum * 0.0009 + 1.4);
  vec2 phaseOffset = vec2(0.016 * (moonPhase - 0.5), 0.0);
  float moonShadow = exp(-pow(length(dMoon + phaseOffset) / 0.031, 2.0));
  float moonLit = clamp(moonDisc - moonShadow * 0.75 + 0.12, 0.0, 1.0);
  finalColor += vec3(0.74, 0.82, 1.00) * moonLit * nightFactor * 0.64;
  finalColor += vec3(0.54, 0.64, 0.94) * moonGlow * nightFactor * 0.32;

  float flockMask = birdFlockField(texCoord, iterNum * 0.014);
  finalColor = mix(finalColor, finalColor * 0.38, clamp(flockMask, 0.0, 0.72));

  fragmentColor = vec4(finalColor, 1.0);
}