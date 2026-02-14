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
  float centerFade = max(1.0 - length(gl_PointCoord - vec2(0.5)) * 2.0, 0.0);
  float opacity = min(totalMass * 0.12, 1.0) * centerFade;

  if (mass_out[ICE] > 0.) {                           // has ice
    if (mass_out[WATER] == 0.) {                      // has no liquid water, pure ice
      if (density_out < 1.0)                          // snow
        fragmentColor = vec4(0.95, 0.97, 1.0, opacity); // snow
      else
        fragmentColor = vec4(0.82, 0.90, 1.0, opacity); // hail
    } else {                                          // mix of ice and water
      fragmentColor = vec4(0.65, 0.88, 1.0, opacity); // wet snow / sleet
    }
  } else {                                            // rain
    fragmentColor = vec4(0.30, 0.65, 1.0, opacity);   // rain
  }

  // fragmentColor = vec4(1.0, 1.0, 0.0, 1.0); // all highly visible for DEBUG
}
