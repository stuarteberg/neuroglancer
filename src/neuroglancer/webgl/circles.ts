/**
 * @license
 * Copyright 2017 Google Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file Facilities for drawing circles in WebGL as quads (triangle fan).
 */

import {drawQuads, glsl_getQuadVertexPosition, VERTICES_PER_QUAD} from 'neuroglancer/webgl/quad';
import {ShaderBuilder, ShaderProgram} from 'neuroglancer/webgl/shader';
import {RefCounted} from 'neuroglancer/util/disposable';
import {SphereRenderHelper} from 'neuroglancer/webgl/spheres';
import {AnnotationRenderContext} from 'neuroglancer/annotation/type_handler';
import {mat4} from 'neuroglancer/util/geom';
import {GL} from 'neuroglancer/webgl/context';

export const VERTICES_PER_CIRCLE = VERTICES_PER_QUAD;

export function defineCircleShader(builder: ShaderBuilder, crossSectionFade: boolean) {
  builder.addVertexCode(glsl_getQuadVertexPosition);
  // x and y components: The x and y radii of the point in normalized device coordinates.
  // z component: Starting point of border from [0, 1]..
  // w component: Fraction of total radius that is feathered.
  builder.addUniform('highp vec3', 'uCircleParams');

  // 2-D position within circle quad, ranging from [-1, -1] to [1, 1].
  builder.addVarying('highp vec4', 'vCircleCoord');
  builder.addVertexCode(`
void emitCircle(vec4 position, float diameter, float borderWidth) {
  gl_Position = position;
  float totalDiameter = diameter + 2.0 * (borderWidth + uCircleParams.z);
  if (diameter == 0.0) totalDiameter = 0.0;
  vec2 circleCornerOffset = getQuadVertexPosition(vec2(-1.0, -1.0), vec2(1.0, 1.0));
  gl_Position.xy += circleCornerOffset * uCircleParams.xy * gl_Position.w * totalDiameter;
  vCircleCoord.xy = circleCornerOffset;
  if (borderWidth == 0.0) {
    vCircleCoord.z = totalDiameter;
    vCircleCoord.w = 1e-6;
  } else {
    vCircleCoord.z = diameter / totalDiameter;
    vCircleCoord.w = uCircleParams.z / totalDiameter;
  }
}
`);
  if (crossSectionFade) {
    builder.addFragmentCode(`
float getCircleAlphaMultiplier() {
  return 1.0 - 2.0 * abs(0.5 - gl_FragCoord.z);
}
`);
  } else {
    builder.addFragmentCode(`
float getCircleAlphaMultiplier() {
  return 1.0;
}
`);
  }
  builder.addFragmentCode(`
vec4 getCircleColor(vec4 interiorColor, vec4 borderColor) {
  float radius = length(vCircleCoord.xy);
  if (radius > 1.0) {
    discard;
  }

  float borderColorFraction = clamp((radius - vCircleCoord.z) / vCircleCoord.w, 0.0, 1.0);
  float feather = clamp((1.0 - radius) / vCircleCoord.w, 0.0, 1.0);
  vec4 color = mix(interiorColor, borderColor, borderColorFraction);

  return vec4(color.rgb, color.a * feather * getCircleAlphaMultiplier());
}
`);
}

export function initializeCircleShader(
    shader: ShaderProgram, projectionParameters: {width: number, height: number},
    options: {featherWidthInPixels: number}) {
  const {gl} = shader;
  gl.uniform3f(
      shader.uniform('uCircleParams'), 1 / projectionParameters.width,
      1 / projectionParameters.height, Math.max(1e-6, options.featherWidthInPixels));
}

export function drawCircles(
    gl: WebGL2RenderingContext, circlesPerInstance: number, numInstances: number) {
  drawQuads(gl, circlesPerInstance, numInstances);
}

export function defineSphereShader(builder: ShaderBuilder, crossSectionFade: boolean) {
  builder.addVertexCode(glsl_getQuadVertexPosition);
  // x and y components: The x and y radii of the point in normalized device coordinates.
  // z component: Starting point of border from [0, 1]..
  // w component: Fraction of total radius that is feathered.
  builder.addUniform('highp vec3', 'uCircleParams');

  // 2-D position within circle quad, ranging from [-1, -1] to [1, 1].
  builder.addVarying('highp vec4', 'vCircleCoord');
  builder.addVertexCode(`
void emitSphere(mat4 projectionMatrix, mat4 normalTransformMatrix, vec3 centerPosition, vec3 radii, vec4 lightDirection) {
  vec3 vertexPosition = aSphereVertex * radii + centerPosition;
  gl_Position = projectionMatrix * vec4(vertexPosition, 1.0);
  vec3 normal = normalize((normalTransformMatrix * vec4(aSphereVertex / max(radii, 1e-6), 0.0)).xyz);
  vLightingFactor = abs(dot(normal, uLightDirection.xyz)) + uLightDirection.w;
}
`);

  builder.addVertexCode(`
void emitSphere(vec4 position, float diameter, float borderWidth) {
  gl_Position = position;
  float totalDiameter = diameter + 2.0 * (borderWidth + uCircleParams.z);
  if (diameter == 0.0) totalDiameter = 0.0;
  vec2 circleCornerOffset = getQuadVertexPosition(vec2(-1.0, -1.0), vec2(1.0, 1.0));
  gl_Position.xy += circleCornerOffset * uCircleParams.xy * gl_Position.w * totalDiameter;
  vCircleCoord.xy = circleCornerOffset;
  if (borderWidth == 0.0) {
    vCircleCoord.z = totalDiameter;
    vCircleCoord.w = 1e-6;
  } else {
    vCircleCoord.z = diameter / totalDiameter;
    vCircleCoord.w = uCircleParams.z / totalDiameter;
  }
}
`);
  if (crossSectionFade) {
    builder.addFragmentCode(`
float getCircleAlphaMultiplier() {
  return 1.0 - 2.0 * abs(0.5 - gl_FragCoord.z);
}
`);
  } else {
    builder.addFragmentCode(`
float getCircleAlphaMultiplier() {
  return 1.0;
}
`);
  }
  builder.addFragmentCode(`
vec4 getCircleColor(vec4 interiorColor, vec4 borderColor) {
  float radius = length(vCircleCoord.xy);
  if (radius > 1.0) {
    discard;
  }

  float borderColorFraction = clamp((radius - vCircleCoord.z) / vCircleCoord.w, 0.0, 1.0);
  float feather = clamp((1.0 - radius) / vCircleCoord.w, 0.0, 1.0);
  vec4 color = mix(interiorColor, borderColor, borderColorFraction);

  return vec4(color.rgb, color.a * feather * getCircleAlphaMultiplier());
}
`);
}

export function initializeSphereShader(
    shader: ShaderProgram, projectionParameters: {width: number, height: number},
    options: {featherWidthInPixels: number}) {
  const {gl} = shader;
  gl.uniform3f(
      shader.uniform('uCircleParams'), 1 / projectionParameters.width,
      1 / projectionParameters.height, Math.max(1e-6, options.featherWidthInPixels));
}

export function drawSpheres(
    gl: WebGL2RenderingContext, circlesPerInstance: number, numInstances: number) {
  drawQuads(gl, circlesPerInstance, numInstances);
}

export class SphereShader extends RefCounted {
  // private squareCornersBuffer: Buffer;
  private sphereHelper: SphereRenderHelper;

  private lightDirection = new Float32Array([1, 0, 0, 0]);

  constructor(gl: GL) {
    super();
    // this.squareCornersBuffer = getSquareCornersBuffer(
        // gl, -1, -1, 1, 1, /*minorTiles=*/circlesPerInstance, /*majorTiles=*/1);
    this.sphereHelper = this.registerDisposer(new SphereRenderHelper(gl, 20, 20));
  }

  defineShader(builder: ShaderBuilder) {
    builder.addUniform('highp vec4', 'uLightDirection');
    builder.addUniform('highp mat4', 'uNormalTransform');

    builder.addVertexCode(`
float getRadiusAdjustment(vec3 vertex, float r) {
  float radiusAdjustment = 1.0;
  for (int i = 0; i < 3; ++i) {
    if (r != 0.0) {
      float d = vertex[i] - uModelClipBounds[i];
      radiusAdjustment -= d * d / (r * r);
    }
  }

  return sqrt(max(0.1, radiusAdjustment));
}
    `);

    this.sphereHelper.defineShader(builder);
  }

  draw(
      shader: ShaderProgram, context: AnnotationRenderContext, count: number) {
    const {gl} = shader;
    // const aCircleCornerOffset = shader.attribute('aCircleCornerOffset');
    // this.squareCornersBuffer.bindToVertexAttrib(aCircleCornerOffset, /*components=*/ 2);
    gl.uniformMatrix4fv(
      shader.uniform('uNormalTransform'), /*transpose=*/ false,
      mat4.transpose(mat4.create(), context.renderSubspaceInvModelMatrix));

    gl.uniform4f(shader.uniform('uLightDirection'), this.lightDirection[0], this.lightDirection[1], this.lightDirection[2], this.lightDirection[3]);
    this.sphereHelper.draw(shader, count);
    // shader.gl.disableVertexAttribArray(aCircleCornerOffset);
  }
}
