/**
 * @license
 * Copyright 2018 Google Inc.
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
 * @file Support for rendering line annotations.
 */

 import {AnnotationType, Sphere} from 'neuroglancer/annotation';
 import {AnnotationRenderContext, AnnotationRenderHelper, AnnotationShaderGetter, registerAnnotationTypeRenderHandler} from 'neuroglancer/annotation/type_handler';
 import {projectPointToLineSegment} from 'neuroglancer/util/geom';
 import {defineCircleShader, initializeCircleShader, drawCircles, SphereShader, VERTICES_PER_CIRCLE} from 'neuroglancer/webgl/circles';
 import {defineLineShader, drawLines, initializeLineShader} from 'neuroglancer/webgl/lines';
 import {ShaderBuilder, ShaderProgram} from 'neuroglancer/webgl/shader';
 import {defineVectorArrayVertexShaderInput} from 'neuroglancer/webgl/shader_lib';
 import {defineVertexId, VertexIdHelper} from 'neuroglancer/webgl/vertex_id';

 //tmp hack
 // import {SphereRenderHelper} from 'neuroglancer/webgl/spheres';
 // import {mat4} from 'neuroglancer/util/geom';

 const FULL_OBJECT_PICK_OFFSET = 0;
 const ENDPOINTS_PICK_OFFSET = FULL_OBJECT_PICK_OFFSET + 1;
 const PICK_IDS_PER_INSTANCE = ENDPOINTS_PICK_OFFSET + 2;

 function defineNoOpEndpointMarkerSetters(builder: ShaderBuilder) {
   builder.addVertexCode(`
 void setAxisEndpointMarkerSize(float startSize, float endSize) {}
 void setAxisEndpointMarkerBorderWidth(float startSize, float endSize) {}
 void setAxisEndpointMarkerColor(vec4 startColor, vec4 endColor) {}
 void setAxisEndpointMarkerBorderColor(vec4 startColor, vec4 endColor) {}
 `);
 }

 function defineNoOpLineSetters(builder: ShaderBuilder) {
   builder.addVertexCode(`
 void setAxisWidth(float width) {}
 void setAxisColor(vec4 startColor, vec4 endColor) {}
 `);
 }

 function defineNoOpSphereSetters(builder: ShaderBuilder) {
   builder.addVertexCode(`
 void setSphereColor(vec4 color) {}
 `);
 }

 class RenderHelper extends AnnotationRenderHelper {
  //  private lineShader = this.registerDisposer(new LineShader(this.gl, 1));
  //  private circleShader = this.registerDisposer(new CircleShader(this.gl, 2));
  //  //tmp hack
  //  // private sphereRenderHelper = this.registerDisposer(new SphereRenderHelper(this.gl, 10, 10));
   private sphereShader = this.registerDisposer(new SphereShader(this.gl));

   defineShader(builder: ShaderBuilder) {
     defineVertexId(builder);

     // Position of endpoints in model coordinates.
     const {rank} = this;
     defineVectorArrayVertexShaderInput(
         builder, 'float', WebGL2RenderingContext.FLOAT, /*normalized=*/ false, 'VertexPosition',
         rank, 2);
   }

   private vertexIdHelper = this.registerDisposer(VertexIdHelper.get(this.gl));

  private edgeShaderGetter =
      this.getDependentShader('annotation/sphere/axis', (builder: ShaderBuilder) => {
        const {rank} = this;
        this.defineShader(builder);
        defineLineShader(builder);
        builder.addVarying(`highp float[${rank}]`, 'vModelPosition');
        builder.addVertexCode(`
float ng_LineWidth;
`);
        defineNoOpEndpointMarkerSetters(builder);
        defineNoOpSphereSetters(builder);

        builder.addVertexCode(`
void setAxisWidth(float width) {
  ng_LineWidth = width;
}
void setAxisColor(vec4 startColor, vec4 endColor) {
  vColor = mix(startColor, endColor, getLineEndpointCoefficient());
}
`);
        builder.setVertexMain(`
float modelPositionA[${rank}] = getVertexPosition0();
float modelPositionB[${rank}] = getVertexPosition1();
for (int i = 0; i < ${rank}; ++i) {
  vModelPosition[i] = mix(modelPositionA[i], modelPositionB[i], getLineEndpointCoefficient());
}
ng_LineWidth = 1.0;
vColor = vec4(0.0, 0.0, 0.0, 0.0);
${this.invokeUserMain}
emitLine(uModelViewProjection * vec4(projectModelVectorToSubspace(modelPositionA), 1.0),
         uModelViewProjection * vec4(projectModelVectorToSubspace(modelPositionB), 1.0),
         ng_LineWidth);
${this.setPartIndex(builder)};
`);
        builder.setFragmentMain(`
float clipCoefficient = getSubspaceClipCoefficient(vModelPosition);
emitAnnotation(vec4(vColor.rgb, vColor.a * getLineAlpha() *
                                ${this.getCrossSectionFadeFactor()} *
                                clipCoefficient));
`);
      });

  private endpointShaderGetter =
      this.getDependentShader('annotation/sphere/endpoint', (builder: ShaderBuilder) => {
        const {rank} = this;
        this.defineShader(builder);
        defineCircleShader(builder, this.targetIsSliceView);
        builder.addVarying('highp float', 'vClipCoefficient');
        builder.addVarying('highp vec4', 'vBorderColor');
        defineNoOpLineSetters(builder);
        defineNoOpSphereSetters(builder);

        builder.addVertexCode(`
float ng_markerDiameter;
float ng_markerBorderWidth;
int getEndpointIndex() {
  return gl_VertexID / ${VERTICES_PER_CIRCLE};
}
void setAxisEndpointMarkerSize(float startSize, float endSize) {
  ng_markerDiameter = mix(startSize, endSize, float(getEndpointIndex()));
}
void setAxisEndpointMarkerBorderWidth(float startSize, float endSize) {
  ng_markerBorderWidth = mix(startSize, endSize, float(getEndpointIndex()));
}
void setAxisEndpointMarkerColor(vec4 startColor, vec4 endColor) {
  vColor = mix(startColor, endColor, float(getEndpointIndex()));
}
void setAxisEndpointMarkerBorderColor(vec4 startColor, vec4 endColor) {
  vBorderColor = mix(startColor, endColor, float(getEndpointIndex()));
}
`);
        builder.setVertexMain(`
float modelPosition[${rank}] = getVertexPosition0();
float modelPositionB[${rank}] = getVertexPosition1();
for (int i = 0; i < ${rank}; ++i) {
  modelPosition[i] = mix(modelPosition[i], modelPositionB[i], float(getEndpointIndex()));
}
vClipCoefficient = getSubspaceClipCoefficient(modelPosition);
vColor = vec4(0.0, 0.0, 0.0, 0.0);
vBorderColor = vec4(0.0, 0.0, 0.0, 1.0);
ng_markerDiameter = 5.0;
ng_markerBorderWidth = 1.0;
${this.invokeUserMain}
emitCircle(uModelViewProjection * vec4(projectModelVectorToSubspace(modelPosition), 1.0), ng_markerDiameter, ng_markerBorderWidth);
${this.setPartIndex(builder, 'uint(getEndpointIndex()) + 1u')};
`);
        builder.setFragmentMain(`
vec4 color = getCircleColor(vColor, vBorderColor);
color.a *= vClipCoefficient;
emitAnnotation(color);
`);
      });

      //tmp hack
  private sphereShadeGetter =
   this.getDependentShader('annotation/sphere/sphere', (builder: ShaderBuilder) => {
     const {rank} = this;
     this.defineShader(builder);
    //  defineVectorArrayVertexShaderInput(
    //      builder, 'float', WebGL2RenderingContext.FLOAT, /*normalized=*/ false, 'VertexPosition',
    //      rank, 2);
     this.sphereShader.defineShader(builder);
     // builder.addAttribute('highp uint', 'aEndpointIndex');
     builder.addVarying('highp float', 'vClipCoefficient');
     // builder.addVarying('highp vec4', 'vBorderColor');

     defineNoOpLineSetters(builder);
     defineNoOpEndpointMarkerSetters(builder);

     builder.addVertexCode(`
 void setSphereColor(vec4 color) {
   vColor = color;
 }
 `);

     builder.setVertexMain(`
 float modelPosition[${rank}] = getVertexPosition0();
 float modelPositionB[${rank}] = getVertexPosition1();
 float diameter = 0.0;
 for (int i = 0; i < ${rank}; ++i) {
   float dx = modelPosition[i] - modelPositionB[i];
   diameter += dx * dx;
   modelPosition[i] = (modelPosition[i] + modelPositionB[i]) * 0.5;
 }
 float radius = sqrt(diameter) * 0.5;
 if (radius > 0.0) {
   vClipCoefficient = getRadiusAdjustment(vec3(modelPosition[0], modelPosition[1], modelPosition[2]), radius);
 } else {
   vClipCoefficient = 1.0;
 }

 // vClipCoefficient = getSubspaceClipCoefficient(modelPosition);
 vColor = vec4(1.0, 0.0, 0.0, 0.5);
 // vColor = vec4(defaultColor(), 0.5);
 ${this.invokeUserMain}
 // float radius = diameter * 0.5;
 emitSphere(uModelViewProjection, uNormalTransform, projectModelVectorToSubspace(modelPosition), vec3(radius, radius, radius), uLightDirection);
 ${this.setPartIndex(builder)};
 `);
     builder.setFragmentMain(`
     vec4 color = vColor;
     color.a *= vClipCoefficient;
     emitAnnotation(color);
 `);
   });

   enable(
     shaderGetter: AnnotationShaderGetter, context: AnnotationRenderContext,
     callback: (shader: ShaderProgram) => void, usingVertexIdHelper = true) {
     super.enable(shaderGetter, context, shader => {
       const binder = shader.vertexShaderInputBinders['VertexPosition'];
       binder.enable(1);
       this.gl.bindBuffer(WebGL2RenderingContext.ARRAY_BUFFER, context.buffer.buffer);
       binder.bind(this.serializedBytesPerAnnotation, context.bufferOffset);
       const { vertexIdHelper } = this;
       if (usingVertexIdHelper) {
        vertexIdHelper.enable();
       }
       callback(shader);
       if (usingVertexIdHelper) {
        vertexIdHelper.disable();
       }
       binder.disable();
     });
   }

   drawEdges(context: AnnotationRenderContext) {
    this.enable(this.edgeShaderGetter, context, shader => {
      initializeLineShader(
          shader, context.renderContext.projectionParameters, /*featherWidthInPixels=*/ 1.0);
      drawLines(shader.gl, 1, context.count);
      // console.log(shader.vertexSource);
      // console.log(shader.fragmentSource);
    });
  }

  drawEndpoints(context: AnnotationRenderContext) {
    this.enable(this.endpointShaderGetter, context, shader => {
      initializeCircleShader(
          shader, context.renderContext.projectionParameters, {featherWidthInPixels: 0.5});
      drawCircles(shader.gl, 2, context.count);
    });
  }

  drawSphere(context: AnnotationRenderContext) {
    this.enable(this.sphereShadeGetter, context, shader => {
      // const aEndpointIndex = shader.attribute('aEndpointIndex');
      // this.endpointIndexBuffer.bindToVertexAttribI(
      //     aEndpointIndex, /*components=*/ 1,
      //     /*attributeType=*/ WebGL2RenderingContext.UNSIGNED_BYTE);

      this.sphereShader.draw(shader, context, context.count);

      // shader.gl.disableVertexAttribArray(aEndpointIndex);
          // shader, context.renderContext.projectionParameters, {featherWidthInPixels: 0.5},
          // context.count);
    }, false);
  }

   draw(context: AnnotationRenderContext) {
     this.drawEdges(context);
     this.drawEndpoints(context);
     this.drawSphere(context);
   }
 }

 function snapPositionToLine(position: Float32Array, endpoints: Float32Array) {
   const rank = position.length;
   projectPointToLineSegment(
       position, endpoints.subarray(0, rank), endpoints.subarray(rank), position);
 }

 function snapPositionToEndpoint(
     position: Float32Array, endpoints: Float32Array, endpointIndex: number) {
   const rank = position.length;
   const startOffset = rank * endpointIndex;
   for (let i = 0; i < rank; ++i) {
     position[i] = endpoints[startOffset + i];
   }
 }

 registerAnnotationTypeRenderHandler<Sphere>(AnnotationType.SPHERE, {
   sliceViewRenderHelper: RenderHelper,
   perspectiveViewRenderHelper: RenderHelper,
   defineShaderNoOpSetters(builder) {
     defineNoOpEndpointMarkerSetters(builder);
     defineNoOpLineSetters(builder);
     defineNoOpSphereSetters(builder);
   },
   pickIdsPerInstance: PICK_IDS_PER_INSTANCE,
   snapPosition(position, data, offset, partIndex) {
     const rank = position.length;
     const endpoints = new Float32Array(data, offset, rank * 2);
     if (partIndex === FULL_OBJECT_PICK_OFFSET) {
       snapPositionToLine(position, endpoints);
     } else {
       snapPositionToEndpoint(position, endpoints, partIndex - ENDPOINTS_PICK_OFFSET);
     }
   },
   getRepresentativePoint(out, ann, partIndex) {
     // if the full object is selected just pick the first point as representative
     out.set(
         (partIndex === FULL_OBJECT_PICK_OFFSET || partIndex === ENDPOINTS_PICK_OFFSET) ?
             ann.pointA :
             ann.pointB);
   },
   updateViaRepresentativePoint(oldAnnotation, position, partIndex) {
     let baseLine = {...oldAnnotation};
     const rank = position.length;
     switch (partIndex) {
       case FULL_OBJECT_PICK_OFFSET: {
         const {pointA, pointB} = oldAnnotation;
         const newPointA = new Float32Array(rank);
         const newPointB = new Float32Array(rank);
         for (let i = 0; i < rank; ++i) {
           const pos = newPointA[i] = position[i];
           newPointB[i] = pointB[i] + (pos - pointA[i]);
         }
         return {...oldAnnotation, pointA: newPointA, pointB: newPointB};
       }
       case FULL_OBJECT_PICK_OFFSET + 1:
         return {...oldAnnotation, pointA: new Float32Array(position)};
       case FULL_OBJECT_PICK_OFFSET + 2:
         return {...oldAnnotation, pointB: new Float32Array(position)};
     }
     return baseLine;
   }
 });
