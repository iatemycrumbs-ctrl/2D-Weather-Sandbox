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
  float radialFade = max(1.0 - length(local) * 2.0, 0.0);
  float streakFade = max(1.0 - abs(local.x) * 2.8, 0.0);
  float centerFade = mix(radialFade, streakFade, 0.45);
  float opacity = min(totalMass * 0.14, 1.0) * centerFade;

  if (mass_out[ICE] > 0.) {                           // has ice
    if (density_out >= 1.0) {                          // graupel / hail carries negative charge
      fragmentColor = vec4(0.25, 0.55, 1.0, opacity); // blue charge dots
    } else {                                           // ice crystals / snow carry positive charge
      fragmentColor = vec4(1.0, 0.35, 0.35, opacity); // red charge dots
    }
  } else {                                             // rain / neutral
    fragmentColor = vec4(0.36, 0.70, 1.0, opacity * 0.9);
  }

  // fragmentColor = vec4(1.0, 1.0, 0.0, 1.0); // all highly visible for DEBUG
}
