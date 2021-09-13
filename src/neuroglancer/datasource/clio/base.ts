/**
 * @license
 * This work is a derivative of the Google Neuroglancer project,
 * Copyright 2016 Google Inc.
 * The Derivative Work is covered by
 * Copyright 2019 Howard Hughes Medical Institute
 *
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

import {vec3} from 'neuroglancer/util/geom';
import { AnnotationPropertySpec } from 'neuroglancer/annotation';

const annotationChunkDataSize = vec3.fromValues(64, 64, 64);

export class ClioSourceParameters {
  baseUrl: string;
  dataset: string;
  api?: string
  kind?: string;
  user?: string;
  groups?: string;
  grayscale?: string;
  authServer?: string;
  authToken?: string;
}

export function isAuthRefreshable(parameters: {authServer?: string}) {
  return parameters.authServer ? (parameters.authServer === 'neurohub' || parameters.authServer.startsWith('http')) : false;
}

export class AnnotationSourceParametersBase extends ClioSourceParameters {
  chunkDataSize = annotationChunkDataSize;
  properties: AnnotationPropertySpec[];
  readonly?: boolean;
  tags?: any;
  schema?: any;
}

export class AnnotationSourceParameters extends AnnotationSourceParametersBase {
  static RPC_ID = 'clio/Annotation';
}

export class AnnotationChunkSourceParameters extends AnnotationSourceParametersBase {
  static RPC_ID = 'clio/AnnotationChunkSource';
}