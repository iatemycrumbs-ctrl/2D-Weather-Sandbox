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
  float r = length(local);

  // New visual model: hydrometeor core + wake plume + refractive halo.
  float wakeBody = max(1.0 - abs(local.x) * 2.6, 0.0) * max(1.0 - abs(local.y) * 1.2, 0.0);
  float streakTrail = exp(-max(local.y + 0.34, 0.0) * 11.5) * max(1.0 - abs(local.x) * 5.0, 0.0);
  float condensedCore = exp(-r * r * 12.0);
  float haloRing = exp(-abs(r - 0.32) * 14.0);
  float wakeTail = exp(-max(local.y + 0.22, 0.0) * 7.5) * max(1.0 - abs(local.x) * 3.1, 0.0);

  float iceFrac = mass_out[ICE] / max(totalMass, 0.0001);
  float rainFrac = mass_out[WATER] / max(totalMass, 0.0001);

  float terminalSpeedHint = mix(0.50, 1.45, clamp(density_out, 0.0, 1.6));
  float anisotropy = mix(0.65, 1.72, rainFrac * terminalSpeedHint);
  float sparkle = pow(max(1.0 - r * 2.1, 0.0), 9.0) * mix(0.35, 1.25, iceFrac);
  float shimmer = sin((local.x - local.y) * 22.0 + totalMass * 35.0) * 0.5 + 0.5;

  float opacity = clamp(totalMass * (0.09 + 0.11 * density_out), 0.05, 1.0);
  opacity *= clamp(wakeBody * anisotropy + condensedCore * 0.92 + wakeTail * 0.40 + streakTrail * (0.20 + 0.55 * rainFrac) + haloRing * 0.22, 0.0, 1.8);

  vec3 rainCol = mix(vec3(0.08, 0.34, 0.90), vec3(0.36, 0.80, 1.00), clamp(rainFrac * 1.2, 0.0, 1.0));
  vec3 snowCol = vec3(0.96, 0.98, 1.00);
  vec3 graupelCol = vec3(0.76, 0.90, 1.00);
  vec3 hailCol = vec3(0.55, 0.80, 1.00);

  vec3 iceCol = density_out >= 1.08 ? hailCol : mix(snowCol, graupelCol, smoothstep(0.20, 1.08, density_out));
  vec3 phaseCol = mix(iceCol, rainCol, rainFrac);
  phaseCol = mix(phaseCol, vec3(0.98, 0.98, 1.0), haloRing * 0.18 * (0.4 + 0.6 * shimmer));

  // Electrification tint and spectral sparkle for visualized microphysics.
  vec3 chargeTint = density_out >= 1.0 ? vec3(0.08, 0.18, 0.30) : vec3(0.14, 0.06, 0.04);
  phaseCol += chargeTint * clamp(iceFrac * 0.32, 0.0, 0.26);
  phaseCol += vec3(0.35, 0.40, 0.48) * sparkle;
  phaseCol += vec3(0.18, 0.24, 0.33) * wakeTail * (0.35 + 0.65 * rainFrac);
  phaseCol += vec3(0.12, 0.18, 0.27) * streakTrail * rainFrac;

  fragmentColor = vec4(clamp(phaseCol, 0.0, 1.0), clamp(opacity, 0.0, 1.0));

  // fragmentColor = vec4(1.0, 1.0, 0.0, 1.0); // all highly visible for DEBUG
}
