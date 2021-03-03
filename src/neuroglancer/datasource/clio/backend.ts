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

import {WithParameters} from 'neuroglancer/chunk_manager/backend';
import {CancellationToken} from 'neuroglancer/util/cancellation';
import {registerSharedObject, SharedObject, RPC} from 'neuroglancer/worker_rpc';
import {Uint64} from 'neuroglancer/util/uint64';
import {Annotation, AnnotationId, AnnotationSerializer, AnnotationPropertySerializer, AnnotationType, /*Sphere, Line,*/ AnnotationPropertySpec} from 'neuroglancer/annotation';
import {AnnotationGeometryChunk, AnnotationGeometryData, AnnotationMetadataChunk, AnnotationSource, AnnotationSubsetGeometryChunk, AnnotationGeometryChunkSourceBackend} from 'neuroglancer/annotation/backend';
import {ANNOTAIION_COMMIT_ADD_SIGNAL_RPC_ID} from 'neuroglancer/datasource/flyem/annotation';
import {ChunkSourceParametersConstructor} from 'neuroglancer/chunk_manager/base';
import {WithSharedCredentialsProviderCounterpart} from 'neuroglancer/credentials_provider/shared_counterpart';
import {AnnotationSourceParameters, AnnotationChunkSourceParameters} from 'neuroglancer/datasource/clio/base';
import {ClioToken, makeRequestWithCredentials, ClioInstance} from 'neuroglancer/datasource/clio/api';
import {ClioAnnotationFacade, ClioPointAnnotation, ClioAnnotation, makeEncoders} from 'neuroglancer/datasource/clio/utils';
import {getAnnotationId, typeOfAnnotationId, isAnnotationIdValid} from 'neuroglancer/datasource/flyem/annotation';


class AnnotationStore {
  store = new Map();

  add(id: string, value: any) {
    if (id) {
      this.store.set(id, value);
    }
  }

  remove(id: string) {
    this.store.delete(id);
  }

  update(id: string, value: any) {
    this.add(id, value);
  }

  getValue(id: string) {
    return this.store.get(id);
  }
}

let annotationStore = new AnnotationStore;

function ClioSource<Parameters, TBase extends {new (...args: any[]): SharedObject}>(
  Base: TBase, parametersConstructor: ChunkSourceParametersConstructor<Parameters>) {
  return WithParameters(
    WithSharedCredentialsProviderCounterpart<ClioToken>()(Base), parametersConstructor);
}


export function parseUint64ToArray(out: Uint64[], v: string): Uint64[] {
  if (v) {
    out.push(Uint64.parseString(v));
  }

  return out;
}

// const annotationPropertySerializer = new AnnotationPropertySerializer(3, []);

function parseAnnotations(
  source: ClioAnnotationSource|ClioAnnotationGeometryChunkSource,
  chunk: AnnotationGeometryChunk | AnnotationSubsetGeometryChunk, responses: any,
  propSpec: AnnotationPropertySpec[], emittingAddSignal: boolean) {
  const annotationPropertySerializer = new AnnotationPropertySerializer(3, propSpec);
  const serializer = new AnnotationSerializer(annotationPropertySerializer);
  if (responses) {
    let parseSingleAnnotation = (key: string, response: any, index: number, lastIndex: number) => {
      if (response) {
        try {
          let annotation = source.decodeAnnotation(key, response);
          if (annotation) {
            if (index === lastIndex) {
              annotation.source = `downloaded:last`;
            } else {
              annotation.source = `downloaded:${index}/${lastIndex}`;
            }
            annotationStore.add(getAnnotationId(annotation), response);
            serializer.add(annotation);
            if (emittingAddSignal) {
              source.rpc!.invoke(ANNOTAIION_COMMIT_ADD_SIGNAL_RPC_ID, {
                id: source.rpcId,
                newAnnotation: annotation
              });
            }
          }
        } catch (e) {
          console.log(`Error parsing annotation: ${e.message}`);
        }
      }
    };

    const {parameters} = source;
    const annotationCount = Object.keys(responses).length;
    Object.keys(responses).forEach((key, index) => {
      let response = responses[key];
      if (response) {
        if (!('Kind' in response)) {
          response['Kind'] = parameters.kind!;
        }
      }
      parseSingleAnnotation(key, response, index, annotationCount - 1);
    });
  }
  chunk.data = Object.assign(new AnnotationGeometryData(), serializer.serialize());
}

// function getTopUrl(parameters: ClioSourceParameters) {
//   return `${parameters.baseUrl}`;
// }

// function getClioUrl(parameters: ClioSourceParameters, path: string) {
//   return getTopUrl(parameters) + path;
// }

/*
function getAnnotationEndpoint(parameters: ClioSourceParameters) {
  return parameters.kind === 'Atlas' ? 'atlas' : 'annotations';
}

function getElementsPath(parameters: ClioSourceParameters) {
  return `/${getAnnotationEndpoint(parameters)}/${parameters.dataset}`;
}

function getAnnotationPath(parameters: ClioSourceParameters, position: ArrayLike<number|string>) {
  return `${getElementsPath(parameters)}?x=${position[0]}&y=${position[1]}&z=${position[2]}`;
}

function getAnnotationUrl(parameters: ClioSourceParameters, position: ArrayLike<number|string>) {
  return getClioUrl(parameters, getAnnotationPath(parameters, position));
}
*/

@registerSharedObject() //
export class ClioAnnotationGeometryChunkSource extends (ClioSource(AnnotationGeometryChunkSourceBackend, AnnotationChunkSourceParameters)) {
  private encoder = makeEncoders(this.parameters.api, this.parameters.kind);
  decodeAnnotation(key: string, entry: any) {
    const type = typeOfAnnotationId(key);
    if (type !== null) {
      return this.encoder[type].decode(key, entry);
    }

    return null;
  }
  async download(chunk: AnnotationGeometryChunk, cancellationToken: CancellationToken) {
    // let values: any[] = [];
    try {
      const clioInstance = new ClioInstance(this.parameters);
      let pointAnnotationValues = await makeRequestWithCredentials(
        this.credentialsProvider,
        {
          method: 'GET',
          url: clioInstance.getAllAnnotationsUrl(),
          payload: undefined,
          responseType: 'json',
        },
        cancellationToken);
      // values = [...pointAnnotationValues];

      return parseAnnotations(this, chunk, pointAnnotationValues, this.parameters.properties, true);
    } catch(e) {
      console.log(e);
    }
  }
}

@registerSharedObject() export class ClioAnnotationSource extends (ClioSource(AnnotationSource, AnnotationSourceParameters)) {
  private encoders = makeEncoders(this.parameters.api, this.parameters.kind);
  constructor(rpc: RPC, options: any) {
    super(rpc, options);
    // updateAnnotationTypeHandler();
  }

  private requestLineMetaData(id: AnnotationId, _: CancellationToken) {
    return Promise.resolve(annotationStore.getValue(id));
  }

  private requestPointMetaData(id: AnnotationId, _: CancellationToken) {
    return Promise.resolve(annotationStore.getValue(id));
    /*
    const { parameters } = this;
    return makeRequestWithCredentials(
      this.credentialsProvider,
      {
        method: 'GET',
        url: getAnnotationUrl(parameters, id.split('_')),
        responseType: 'json',
      },
      cancellationToken).then(
        response => {
          if (response && response.length > 0) {
            return response[0];
          } else {
            return response;
          }
        }
      );
      */
  }

  private requestMetadata(chunk: AnnotationMetadataChunk, cancellationToken: CancellationToken) {
    const id = chunk.key!;
    switch (typeOfAnnotationId(id)) {
      case AnnotationType.POINT:
        return this.requestPointMetaData(id, cancellationToken);
      case AnnotationType.LINE:
        return this.requestLineMetaData(id, cancellationToken);
      default:
        throw new Error(`Invalid annotation ID for DVID: ${id}`);
    }
  }

  downloadMetadata(chunk: AnnotationMetadataChunk, cancellationToken: CancellationToken) {
    return this.requestMetadata(chunk, cancellationToken).then(
      response => {
        if (response) {
          chunk.annotation = this.decodeAnnotation(chunk.key!, response);
        } else {
          chunk.annotation = null;
        }
      }
    )
  }

  private uploadable(annotation: Annotation|string){
    const encoder = this.getEncoder(annotation);
    if (encoder) {
      return encoder.uploadable(typeof annotation === 'string' ? encoder.decode(annotation, annotationStore.getValue(annotation)) : annotation);
    }

    return false;
  }

  decodeAnnotation(key: string, entry: any): ClioAnnotation|null {
    const type = typeOfAnnotationId(key);
    if (type) {
      return this.encoders[type].decode(key, entry);
    }

    return null;
  }

  private getEncoder(annotation: Annotation|string) {
    let type: AnnotationType|null = null;
    if (typeof annotation === 'string') {
      type = typeOfAnnotationId(annotation);
    } else {
      type = annotation.type;
    }

    if (type !== null) {
      return this.encoders[type];
    }

    return undefined;
  }

  private encodeAnnotation(annotation: ClioAnnotation): any {
    const encoder = this.getEncoder(annotation);
    if (encoder) {
      return encoder.encode(annotation);
    }

    return null;
  }

  private updateAnnotation(annotation: ClioAnnotation) {
    try {
      const { parameters } = this;
      if (!parameters.user) {
        throw Error('Cannot upload an annotation without a user');
      }

      (new ClioAnnotationFacade(annotation)).user = parameters.user;
      const encoded = this.encodeAnnotation(annotation);
      if (encoded === null) {
        throw new Error('Unable to encode the annotation');
      }
      let value = JSON.stringify(encoded);
      annotationStore.update(getAnnotationId(annotation), encoded);

      if (this.uploadable(annotation)) {
        const clioInstance = new ClioInstance(parameters);
        return makeRequestWithCredentials(
          this.credentialsProvider,
          {
            method: 'POST',
            url: clioInstance.getPostAnnotationUrl((<ClioPointAnnotation>annotation).point),
            payload: value,
            responseType: 'json',
          });
      } else {
        return Promise.resolve(getAnnotationId(annotation));
      }
    } catch (e) {
      return Promise.reject(e);
    }
  }

  private addAnnotation(annotation: ClioAnnotation) {
    return this.updateAnnotation(annotation)
      .then((response) => {
        if (typeof response === 'string' && response.length > 0) {
          return response;
        }

        if ('key' in response && response.key) {
          return response.key;
        }

        return getAnnotationId(annotation);
      })
      .catch(e => {
        throw new Error(e);
      });
  }

  add(annotation: Annotation) {
    return this.addAnnotation(<ClioAnnotation>annotation);
  }

  update(id: AnnotationId, annotation: Annotation) {
    if (getAnnotationId(<ClioAnnotation>annotation) !== id) {
      (<ClioAnnotation>annotation).key = id; //TODO: may need a safer way to handle id difference
    }

    return this.updateAnnotation(<ClioAnnotation>annotation);
  }

  private deleteAnnotation(id: AnnotationId) {
    const clioInstance = new ClioInstance(this.parameters);

    if (this.uploadable(id)) {
      return makeRequestWithCredentials(
        this.credentialsProvider,
        {
          method: 'DELETE',
          url: clioInstance.getDeleteAnnotationUrl(id),
          // url: getAnnotationUrl(parameters, id.split('_')),
          responseType: ''
        }).then(() => { annotationStore.remove(id); });
    } else {
      annotationStore.remove(id);
      return Promise.resolve();
    }
  }

  delete(id: AnnotationId) {
    if (isAnnotationIdValid(id)) {
      try {
        return this.deleteAnnotation(id);
      } catch (e) {
        return Promise.reject(e);
      }
    } else {
      return Promise.resolve();
    }
  }
}
