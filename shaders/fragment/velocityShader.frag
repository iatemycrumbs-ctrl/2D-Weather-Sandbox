#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;
in vec2 texCoord;     // this
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;

uniform float dragMultiplier;

uniform float wind;
uniform float coriolisStrength;
uniform float turbulentMix;
uniform float jetStreamCoupling;
uniform float gravityWaveDrag;
uniform float mountainWaveStrength;
uniform float vortexStretching;
uniform float ageostrophicFlow;
uniform float moistBuoyancyBoost;
uniform float gravityCurrentStrength;
uniform float shearProduction;
uniform float tornadoPotential;
uniform float frontogenesisStrength;
uniform float gradientRichardsonMix;
uniform float turbulentPrandtl;
uniform float pblDepthMeters;
uniform float entrainmentFluxBoost;

uniform vec2 texelSize;
// uniform vec2 resolution;

uniform vec4 initial_Tv[126];

float getInitialT(int y) { return initial_Tv[y / 4][y % 4]; }

layout(location = 0) out vec4 base;
layout(location = 2) out ivec4 wall;

float dryLapse; // NOT USED needs to be declared for common.glsl
vec2 resolution;
#include "common.glsl"

void main()
{
  base = texture(baseTex, texCoord);
  vec4 baseXpY0 = texture(baseTex, texCoordXpY0);
  vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);
  vec4 baseXmY0 = texture(baseTex, vec2(texCoord.x - texelSize.x, texCoord.y));
  vec4 baseX0Ym = texture(baseTex, vec2(texCoord.x, texCoord.y - texelSize.y));
  vec4 water = texture(waterTex, texCoord);
  vec4 waterX0Ym = texture(waterTex, vec2(texCoord.x, texCoord.y - texelSize.y));

  wall = texture(wallTex, texCoord);
  ivec4 wallX0Yp = texture(wallTex, texCoordX0Yp);
  ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);


  // set boundaries: no flow in or out of wall cells
  if (wall[DISTANCE] == 0) // is wall
  {
    base[VX] = 0.0;        // velocities in wall are 0
    base[VY] = 0.0;        // this will make a wall not let any pressure trough and
                           // thereby reflect any pressure waves back
  } else {

    float airTemp = base[TEMPERATURE];
    float densityDrag = map_rangeC(airTemp, CtoK(-45.0), CtoK(35.0), 1.25, 0.70) * map_rangeC(texCoord.y, 0.0, 1.0, 1.0, 0.70);

    if (wallXpY0[DISTANCE] == 0) {
      base[VX] = 0.0;                                  // Since X velocity is defined at the right of the cell, it has to be done in the cell to the left of the wall
    } else {
      base[VX] += base[PRESSURE] - baseXpY0[PRESSURE]; // The velocity through the cell changes proportionally to the pressure gradient across the cell. It's basically just newtons 2nd law.

      // New physics: thinner / warmer air has less drag, denser / colder air has more drag.
      base[VX] *= 1. - dragMultiplier * 0.0002 * densityDrag; // altitude/temperature adjusted drag
    }

    base[VY] += base[PRESSURE] - baseX0Yp[PRESSURE];

    // Realistic-ish Coriolis term (f-plane approximation) with latitude from GUI control.
    float coriolisParam = 0.00045 * coriolisStrength;
    float vOld = base[VY];
    base[VX] += -vOld * coriolisParam;
    base[VY] += base[VX] * coriolisParam;

    base[VY] *= 1. - dragMultiplier * 0.0002 * densityDrag;

    // Complex feature upgrade: subgrid turbulent mixing + jet-stream baroclinic coupling.
    vec2 laplacianV = vec2(baseXpY0[VX] + baseXmY0[VX] + baseX0Yp[VX] + baseX0Ym[VX] - 4.0 * base[VX],
                           baseXpY0[VY] + baseXmY0[VY] + baseX0Yp[VY] + baseX0Ym[VY] - 4.0 * base[VY]);
    float stratification = clamp((base[TEMPERATURE] - getInitialT(int(fragCoord.y))) * 0.08 + 0.5, 0.05, 1.9);

    float dThetaDz = (baseX0Yp[TEMPERATURE] - baseX0Ym[TEMPERATURE]) / max(texelSize.y * 2.0, 1e-6);
    float dUdz = (baseX0Yp[VX] - baseX0Ym[VX]) / max(texelSize.y * 2.0, 1e-6);
    float dVdz = (baseX0Yp[VY] - baseX0Ym[VY]) / max(texelSize.y * 2.0, 1e-6);
    float shear2 = dUdz * dUdz + dVdz * dVdz + 1e-7;
    float Ri = clamp((9.81 / max(airTemp, 150.0)) * dThetaDz / shear2, -3.0, 3.0);
    float riMix = map_rangeC(Ri, -0.2, 0.25, 1.40, 0.35) * gradientRichardsonMix;

    float pblNorm = clamp((pblDepthMeters / 12000.0), 0.02, 1.0);
    float pblWeight = 1.0 - smoothstep(pblNorm * 0.7, pblNorm * 1.4, texCoord.y);
    float mixCoeff = 0.014 * turbulentMix * stratification * riMix;
    base.xy += laplacianV * mixCoeff * (0.55 + 0.45 * pblWeight);

    float dTdx = (baseXpY0[TEMPERATURE] - baseXmY0[TEMPERATURE]);
    float dTdy = (baseX0Yp[TEMPERATURE] - baseX0Ym[TEMPERATURE]);
    vec2 baroclinic = vec2(-dTdy, dTdx) * (0.0000018 * jetStreamCoupling);
    float upperLevelWeight = smoothstep(0.35, 0.95, texCoord.y);
    base.xy += baroclinic * upperLevelWeight;

    float gravityWaveDamp = map_rangeC(abs(base[VY]), 0.0, 0.03, 0.0, 0.0009) * gravityWaveDrag;
    base[VY] -= sign(base[VY]) * gravityWaveDamp;

    float mountainLift = (1.0 - smoothstep(0.0, 0.45, texCoord.y)) * mountainWaveStrength;
    base[VY] += sin(texCoord.x * 12.0 + float(fragCoord.y) * 0.017) * 0.00008 * mountainLift;

    float vort = (baseXpY0[VY] - baseXmY0[VY]) - (baseX0Yp[VX] - baseX0Ym[VX]);
    base[VY] += vort * 0.00005 * vortexStretching * upperLevelWeight;

    vec2 geostrophicAdj = vec2(-dTdy, -dTdx) * (0.0000007 * ageostrophicFlow);
    base.xy += geostrophicAdj;

    // Complex moisture / density-current / shear production coupling
    float moistureAnomaly = clamp((water[TOTAL] - 8.0) * 0.09, -0.7, 1.2);
    float cloudBuoyancy = clamp(water[CLOUD] * 0.16 + moistureAnomaly * 0.45, -0.3, 1.4);
    float coldPoolSignal = clamp((waterX0Ym[PRECIPITATION] - water[PRECIPITATION]) * 2.2 + (waterX0Ym[CLOUD] - water[CLOUD]) * 0.6, -1.1, 1.4);

    base[VY] += cloudBuoyancy * 0.00009 * moistBuoyancyBoost;
    base[VX] += -sign(coldPoolSignal) * abs(coldPoolSignal) * 0.00006 * gravityCurrentStrength;

    float verticalShear = abs(baseX0Yp[VX] - baseX0Ym[VX]) + abs(baseXpY0[VY] - baseXmY0[VY]);
    float shearMixing = min(verticalShear * 0.06, 2.0) * shearProduction;
    float prandtlLimiter = map_rangeC(turbulentPrandtl, 0.2, 2.0, 1.45, 0.60);
    base.xy += laplacianV * (0.0045 * shearMixing * prandtlLimiter);

    float entrainSignal = max(baseX0Yp[VY] - base[VY], 0.0) + max(base[VX] - baseXmY0[VX], 0.0);
    base[VY] += entrainSignal * 0.000035 * entrainmentFluxBoost * (0.35 + pblWeight);

    // Tornado proxy: low-level stretch + buoyancy + vorticity focus
    float lowLevel = 1.0 - smoothstep(0.10, 0.42, texCoord.y);
    float convergence = max((baseXmY0[VX] - baseXpY0[VX]) + (baseX0Ym[VY] - baseX0Yp[VY]), 0.0);
    float tornadoSpin = max(vort, 0.0) * convergence * cloudBuoyancy * lowLevel;
    base[VX] += -base[VY] * tornadoSpin * 0.000025 * tornadoPotential;
    base[VY] += base[VX] * tornadoSpin * 0.000018 * tornadoPotential;

    // Storm-front proxy: strengthen horizontal thermal-gradient acceleration near low levels
    float frontGradient = length(vec2(dTdx, dTdy));
    float frontWeight = (1.0 - smoothstep(0.18, 0.75, texCoord.y)) * smoothstep(0.0001, 0.008, frontGradient);
    vec2 frontPush = normalize(vec2(-dTdx, -dTdy) + vec2(1e-6)) * frontGradient * 0.0000009 * frontogenesisStrength;
    base.xy += frontPush * frontWeight;

    // quadratic drag
    // base[VX] -= base[VX] * base[VX] * base[VX] * base[VX] * base[VX] *
    // dragMultiplier; base[VY] -= base[VY] * base[VY] * base[VY] * base[VY] *
    // base[VY] * dragMultiplier;

    base[VX] += wind * 0.000001;
  }
}
