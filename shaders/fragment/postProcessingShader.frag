#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

vec2 fragCoord;          // (in) not used just defined for commonDisplay.glsl
in vec2 texCoord;        // this
in vec2 texCoordXmY0;    // left
in vec2 texCoordX0Ym;    // down
in vec2 texCoordXpY0;    // right
in vec2 texCoordX0Yp;    // up

uniform vec2 resolution; // sim resolution
uniform vec2 texelSize;

uniform float exposure;
uniform float motionBlurStrength;
uniform float antiAliasing;
uniform float bloomIntensity;
uniform float postContrast;
uniform float postSaturation;
uniform float postVignette;
uniform float postSharpen;

uniform sampler2D hdrTex;
uniform sampler2D bloomTex;
out vec4 fragmentColor;


#include "commonDisplay.glsl"

float luma(vec3 c)
{
  return dot(c, vec3(0.299, 0.587, 0.114));
}


void main()
{
  vec3 outputCol = texture(hdrTex, texCoord).rgb;

  if (postSharpen > 0.001) {
    vec3 cL = texture(hdrTex, texCoordXmY0).rgb;
    vec3 cR = texture(hdrTex, texCoordXpY0).rgb;
    vec3 cU = texture(hdrTex, texCoordX0Yp).rgb;
    vec3 cD = texture(hdrTex, texCoordX0Ym).rgb;
    vec3 edge = outputCol * 5.0 - (cL + cR + cU + cD);
    outputCol = mix(outputCol, outputCol + edge * 0.25, clamp(postSharpen, 0.0, 1.0));
  }

  vec2 blurDir = normalize(vec2(0.85, 0.52));
  vec2 blurStep = texelSize * blurDir * motionBlurStrength * 4.0;
  vec3 blurA = texture(hdrTex, texCoord + blurStep).rgb;
  vec3 blurB = texture(hdrTex, texCoord - blurStep).rgb;
  outputCol = mix(outputCol, (outputCol + blurA + blurB) / 3.0, motionBlurStrength * 0.75);

  vec3 bloom = texture(bloomTex, texCoord).rgb;

  outputCol += bloom * 0.990 * bloomIntensity; // apply bloom

  if (antiAliasing > 0.5) {
    vec3 cL = texture(hdrTex, texCoordXmY0).rgb;
    vec3 cR = texture(hdrTex, texCoordXpY0).rgb;
    vec3 cU = texture(hdrTex, texCoordX0Yp).rgb;
    vec3 cD = texture(hdrTex, texCoordX0Ym).rgb;
    float lMin = min(luma(outputCol), min(min(luma(cL), luma(cR)), min(luma(cU), luma(cD))));
    float lMax = max(luma(outputCol), max(max(luma(cL), luma(cR)), max(luma(cU), luma(cD))));
    float edge = smoothstep(0.04, 0.26, lMax - lMin);
    vec3 neighborhood = (cL + cR + cU + cD + outputCol) / 5.0;
    outputCol = mix(outputCol, neighborhood, edge * 0.55);
  }

  // outputCol = outputCol / (outputCol + vec3(1.0)) * 1.1; // Tone mapping

  float gray = dot(outputCol, vec3(0.2126, 0.7152, 0.0722));
  outputCol = mix(vec3(gray), outputCol, postSaturation);
  outputCol = (outputCol - 0.5) * postContrast + 0.5;

  float vignetteDist = distance(texCoord, vec2(0.5));
  float vignette = 1.0 - smoothstep(0.30, 0.80, vignetteDist) * postVignette;
  outputCol *= vignette;

  outputCol *= exposure;

  outputCol = pow(outputCol, ONE_OVER_GAMMA); // gamma correction


  /*
    { // Gamma correction test: left without, right with gamma correction
      float modTexCoordx = mod(texCoord.x, 0.5);
      // outputCol = vec3(pow(texCoord.y, 2.)); // light input

      outputCol = vec3(pow(0.9, (1. - texCoord.y) * 50.)); // simulate light coming down and being absorbed by clouds

      if (texCoord.x > 0.5)
        outputCol = pow(outputCol, GAMMA);              // gamma correction

      if (abs(outputCol.r - modTexCoordx * 2.) < 0.001) // plot brightness
        outputCol = vec3(1.0, 0., 0.);
    }
  */

  fragmentColor = vec4(outputCol, 1.0);
}
