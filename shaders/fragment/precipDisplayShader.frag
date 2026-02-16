#version 300 es
precision highp float;

in vec2 position_out;
in vec2 mass_out;
in float density_out;

out vec4 fragmentColor;

// Precipitation mass:
#define WATER 0
#define ICE 1

void main()
{

  if (mass_out[WATER] < 0.)
    discard;

  /* // dots:
  if(mass_out[1] > 0.){
      if(density_out < 1.0)
          fragmentColor = vec4(1.0, 1.0, 1.0, 1.0); // snow
      else
          fragmentColor = vec4(1.0, 1.0, 0.0, 1.0); // hail
  }else
  fragmentColor = vec4(0.0, 1.0, 1.0, 1.0); // rain
  */

  float totalMass = mass_out[WATER] + mass_out[ICE];
  vec2 local = gl_PointCoord - vec2(0.5);
  float radialFade = max(1.0 - length(local) * 1.95, 0.0);
  float streakFade = max(1.0 - abs(local.x) * 2.6, 0.0);
  float centerFade = mix(radialFade, streakFade, 0.52);
  float iceFrac = mass_out[ICE] / max(totalMass, 0.0001);
  float rainFrac = mass_out[WATER] / max(totalMass, 0.0001);
  float opacity = clamp(totalMass * (0.10 + 0.06 * density_out), 0.04, 1.0) * centerFade;

  vec3 rainCol = mix(vec3(0.22, 0.62, 1.0), vec3(0.62, 0.88, 1.0), clamp(rainFrac * 1.2, 0.0, 1.0));
  vec3 snowCol = vec3(0.94, 0.98, 1.0);
  vec3 graupelCol = vec3(0.55, 0.76, 1.0);
  vec3 hailCol = vec3(0.30, 0.50, 1.0);

  vec3 iceCol = density_out >= 1.08 ? hailCol : mix(snowCol, graupelCol, smoothstep(0.20, 1.08, density_out));
  vec3 phaseCol = mix(rainCol, iceCol, clamp(iceFrac, 0.0, 1.0));

  // subtle charge tint: graupel/hail blue-negative, crystals/snow warm-positive
  vec3 chargeTint = density_out >= 1.0 ? vec3(0.12, 0.22, 0.38) : vec3(0.16, 0.06, 0.06);
  phaseCol += chargeTint * clamp(iceFrac * 0.35, 0.0, 0.30);

  fragmentColor = vec4(clamp(phaseCol, 0.0, 1.0), opacity);

  // fragmentColor = vec4(1.0, 1.0, 0.0, 1.0); // all highly visible for DEBUG
}
