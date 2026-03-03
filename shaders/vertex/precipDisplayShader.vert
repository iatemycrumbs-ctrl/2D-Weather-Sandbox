#version 300 es
precision highp float;

in vec2 dropPosition;
in vec2 mass; //[0] water   [1] ice
in float density;

out vec2 position_out;
out vec2 mass_out;
out float density_out;

uniform vec2 texelSize;
uniform vec2 aspectRatios; // sim   canvas
uniform vec3 view;         // Xpos  Ypos    Zoom

void main()
{
  vec2 outpos = dropPosition;

  outpos.x += view.x;
  outpos.y += view.y * aspectRatios[0];

  outpos *= view[2];
  outpos.y *= aspectRatios[1] / aspectRatios[0];

  gl_Position = vec4(outpos, 0.0, 1.0);

  float totalMass = max(mass[0] + mass[1], 0.0001);
  float waterFrac = clamp(mass[0] / totalMass, 0.0, 1.0);
  float iceFrac = clamp(mass[1] / totalMass, 0.0, 1.0);

  float rainSize = mix(2.8, 6.6, clamp(totalMass * 2.2, 0.0, 1.0));
  float hailSize = mix(4.2, 10.5, clamp(mass[1] * 2.8, 0.0, 1.0));
  float snowSize = mix(3.4, 8.0, clamp(totalMass * 1.7, 0.0, 1.0));

  float densityBlend = smoothstep(0.22, 1.05, density);
  float hydroSize = mix(snowSize, hailSize, densityBlend);
  hydroSize = mix(hydroSize, rainSize, waterFrac);

  // tiny deterministic flicker to avoid perfectly static particles when zoomed in.
  float flicker = 0.92 + 0.08 * sin(float(gl_VertexID) * 0.11 + dropPosition.x * 37.0 + dropPosition.y * 19.0);
  float size = hydroSize * flicker * (0.92 + 0.18 * iceFrac);

  gl_PointSize = max(1.0, view[2] * size / aspectRatios[0]);

  position_out = dropPosition;
  mass_out = mass;
  density_out = density;
}
