#version 300 es
precision highp float;

in vec2 position_out;
in vec2 mass_out;
in float density_out;

out vec4 fragmentColor;

#define WATER 0
#define ICE 1

float hash12(vec2 p)
{
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main()
{
  if (mass_out[WATER] < 0.0)
    discard;

  float totalMass = max(mass_out[WATER] + mass_out[ICE], 0.0001);
  float waterFrac = clamp(mass_out[WATER] / totalMass, 0.0, 1.0);
  float iceFrac = clamp(mass_out[ICE] / totalMass, 0.0, 1.0);

  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float radial = length(uv);

  float dropletStretch = mix(1.6, 0.8, clamp(density_out, 0.0, 1.4));
  float core = exp(-dot(vec2(uv.x * dropletStretch, uv.y), vec2(uv.x * dropletStretch, uv.y)) * 4.8);

  float streak = exp(-max(uv.y + 0.15, 0.0) * 8.0) * max(1.0 - abs(uv.x) * (2.6 + waterFrac * 2.4), 0.0);
  float splashHalo = exp(-abs(radial - 0.46) * 9.5) * (0.35 + 0.65 * iceFrac);
  float mist = exp(-max(uv.y + 0.42, 0.0) * 4.6) * max(1.0 - abs(uv.x) * 1.8, 0.0);

  float shardNoise = hash12(position_out * 741.13 + uv * 8.7);
  float hailShard = step(1.05, density_out) * pow(max(1.0 - abs(radial - 0.26) * 4.4, 0.0), 7.0) * (0.55 + 0.45 * shardNoise);

  vec3 rainColA = vec3(0.08, 0.34, 0.92);
  vec3 rainColB = vec3(0.42, 0.86, 1.00);
  vec3 rainCol = mix(rainColA, rainColB, clamp(0.25 + waterFrac * 0.95, 0.0, 1.0));

  vec3 snowCol = vec3(0.96, 0.98, 1.00);
  vec3 graupelCol = vec3(0.82, 0.92, 1.00);
  vec3 hailCol = vec3(0.99, 1.00, 1.00);

  vec3 iceCol = density_out >= 1.05 ? hailCol : mix(snowCol, graupelCol, smoothstep(0.20, 1.05, density_out));
  vec3 phaseCol = mix(iceCol, rainCol, waterFrac);

  phaseCol += vec3(0.16, 0.24, 0.34) * streak * waterFrac;
  phaseCol += vec3(0.30, 0.36, 0.45) * mist * (0.3 + waterFrac * 0.7);
  phaseCol += vec3(0.84, 0.90, 1.0) * splashHalo * 0.45;
  phaseCol += vec3(0.86, 0.90, 0.98) * hailShard;

  float body = clamp(core * (0.92 + 0.22 * iceFrac) + streak * 0.50 + mist * 0.38 + splashHalo * 0.25, 0.0, 1.9);
  float opacity = clamp(totalMass * (0.09 + density_out * 0.11) * body + hailShard * 0.18, 0.04, 1.0);

  fragmentColor = vec4(clamp(phaseCol, 0.0, 1.0), opacity);
}
