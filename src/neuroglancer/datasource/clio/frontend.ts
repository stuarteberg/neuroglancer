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

import {MultiscaleAnnotationSource, AnnotationGeometryChunkSource} from 'neuroglancer/annotation/frontend_source';
import {ChunkManager, WithParameters} from 'neuroglancer/chunk_manager/frontend';
import {WithCredentialsProvider} from 'neuroglancer/credentials_provider/chunk_source_frontend';
import { AnnotationType, Annotation, AnnotationReference } from 'neuroglancer/annotation';
import {Signal} from 'neuroglancer/util/signal';
import {CredentialsManager, CredentialsProvider} from 'neuroglancer/credentials_provider';
import {VolumeSourceOptions} from 'neuroglancer/sliceview/volume/base';
import { makeSliceViewChunkSpecification } from 'neuroglancer/sliceview/base';
import {SliceViewSingleResolutionSource} from 'neuroglancer/sliceview/frontend';
import {mat4} from 'neuroglancer/util/geom';
import {BoundingBox, makeCoordinateSpace, makeIdentityTransform, makeIdentityTransformedBoundingBox} from 'neuroglancer/coordinate_transform';
// import {parseArray, parseFixedLengthArray, parseQueryStringParameters, verifyEnumString, verifyFinitePositiveFloat, verifyInt, verifyObject, verifyObjectProperty, verifyOptionalObjectProperty, verifyPositiveInt, verifyString} from 'neuroglancer/util/json';
import {parseQueryStringParameters, verifyObject, verifyObjectProperty, verifyString} from 'neuroglancer/util/json';
import {CompleteUrlOptions, DataSource, DataSourceProvider, GetDataSourceOptions} from 'neuroglancer/datasource';
import {getUserFromToken} from 'neuroglancer/datasource/flyem/annotation';
import {ClioAnnotationFacade, parseDescription} from 'neuroglancer/datasource/clio/utils';
import {Borrowed} from 'neuroglancer/util/disposable';
import {makeRequest} from 'neuroglancer/datasource/dvid/api';
import {StatusMessage} from 'neuroglancer/status';
import {FlyEMAnnotation} from 'neuroglancer/datasource/flyem/annotation';
import {vec3} from 'neuroglancer/util/geom';
import {VolumeInfo} from 'neuroglancer/datasource/flyem/datainfo';
import {makeAnnotationEditWidget} from 'neuroglancer/datasource/flyem/widgets';
import {defaultAnnotationSchema, defaultAtlasSchema} from 'neuroglancer/datasource/clio/utils';
import {ClioToken, credentialsKey, makeRequestWithCredentials, getGrayscaleInfoUrl, ClioInstance, parseGrayscaleUrl} from 'neuroglancer/datasource/clio/api';
import {AnnotationSourceParameters, AnnotationChunkSourceParameters, ClioSourceParameters, isAuthRefreshable} from 'neuroglancer/datasource/clio/base';

class ClioAnnotationChunkSource extends
(WithParameters(WithCredentialsProvider<ClioToken>()(AnnotationGeometryChunkSource), AnnotationChunkSourceParameters)) {}

async function getAnnotationDataInfo(parameters: AnnotationSourceParameters): Promise<VolumeInfo> {
  const { grayscale } = parameters;
  if (grayscale) {
    let u = parseGrayscaleUrl(grayscale);
    return makeRequest({
      'method': 'GET',
      'url': getGrayscaleInfoUrl(u),
      responseType: 'json'
    }).then(response => {
      return new VolumeInfo(response, (u.protocol === 'https') ? 'gs' : u.protocol);
    });
  } else {
    return Promise.resolve({
      numChannels: 1,
      voxelSize: vec3.fromValues(8, 8, 8),
      lowerVoxelBound: vec3.fromValues(0, 0, 0),
      upperVoxelBound: vec3.fromValues(50000, 50000, 50000),
      blockSize: vec3.fromValues(64, 64, 64),
      numLevels: 1
    });
    // throw Error('No volume information provided.');
  }
}

function makeAnnotationGeometrySourceSpecifications(dataInfo: VolumeInfo) {
  const rank = 3;

  let makeSpec = (info: VolumeInfo) => {
    const chunkDataSize = info.upperVoxelBound;
    let spec = makeSliceViewChunkSpecification({
      rank,
      chunkDataSize: Uint32Array.from(chunkDataSize),
      lowerVoxelBound: info.lowerVoxelBound,
      upperVoxelBound: info.upperVoxelBound
    });

    return { spec, chunkToMultiscaleTransform: mat4.create()};
  };

  return [[makeSpec(dataInfo)]];
}

const MultiscaleAnnotationSourceBase = WithParameters(
  WithCredentialsProvider<ClioToken>()(MultiscaleAnnotationSource), AnnotationSourceParameters);

export class ClioAnnotationSource extends MultiscaleAnnotationSourceBase {
  key: any;
  readonly = false;
  private dataInfo: VolumeInfo;

  constructor(chunkManager: ChunkManager, options: {
    credentialsProvider: CredentialsProvider<ClioToken>,
    parameters: AnnotationSourceParameters,
    dataInfo: VolumeInfo
  }) {
    super(chunkManager, {
      rank: 3,
      relationships: ['segments'],
      properties: options.parameters.properties,
      ...options
    });

    this.parameters = options.parameters;
    this.dataInfo = options.dataInfo;

    this.childAdded = this.childAdded || new Signal<(annotation: Annotation) => void>();
    this.childUpdated = this.childUpdated || new Signal<(annotation: Annotation) => void>();
    this.childDeleted = this.childDeleted || new Signal<(annotationId: string) => void>();

    this.makeEditWidget = (reference: AnnotationReference) => {
      const getFacade = (annotation: FlyEMAnnotation) => {
        return new ClioAnnotationFacade(annotation);
      }

      const getProp = (annotation: FlyEMAnnotation) => {
        return {...annotation.prop, ...annotation.ext};
      };
      const setProp = (annotation: FlyEMAnnotation, prop: {[key:string]: any}) => {
        const annotationRef = new ClioAnnotationFacade(annotation);
        if (prop.title) {
          annotationRef.title = prop.title;
        }
        if (prop.description) {
          annotationRef.description = prop.description;
        }
      };

      return makeAnnotationEditWidget(reference, this.parameters.schema, this, getFacade, getProp, setProp);
    };

    this.getUser = () => this.parameters.user;
  }

  getSources(_options: VolumeSourceOptions):
    SliceViewSingleResolutionSource<AnnotationGeometryChunkSource>[][] {

    let sourceSpecifications = makeAnnotationGeometrySourceSpecifications(this.dataInfo);

    let limit = 0;
    if (sourceSpecifications[0].length > 1) {
      limit = 10;
    }

    return sourceSpecifications.map(
      alternatives =>
        alternatives.map(({ spec, chunkToMultiscaleTransform }) => ({
          chunkSource: this.chunkManager.getChunkSource(ClioAnnotationChunkSource, {
            spec: { limit, chunkToMultiscaleTransform, ...spec },
            parent: this,
            credentialsProvider: this.credentialsProvider,
            parameters: this.parameters
          }),
          chunkToMultiscaleTransform
        })));
  }

  * [Symbol.iterator](): Iterator<Annotation> {
    for (let reference of this.references) {
      if (reference[1].value) {
        yield reference[1].value;
      }
    }
  }

  commit(reference: Borrowed<AnnotationReference>) {
    if (reference.value && (reference.value.type === AnnotationType.LINE || reference.value.type === AnnotationType.SPHERE)) {
      reference.value.pointA = reference.value.pointA.map(x => Math.round(x));
      reference.value.pointB = reference.value.pointB.map(x => Math.round(x));
    }
    super.commit(reference);
  }

  add(annotation: Annotation, commit: boolean = true): AnnotationReference {
    if (this.readonly) {
      let errorMessage = 'Permission denied for changing annotations.';
      StatusMessage.showTemporaryMessage(errorMessage);
      throw Error(errorMessage);
    }

    const clioAnnotation = new ClioAnnotationFacade(annotation);
    clioAnnotation.addTimeStamp();
    if (this.parameters.user) {
      clioAnnotation.user = this.parameters.user;
    }

    if (annotation.type === AnnotationType.POINT) {
      clioAnnotation.kind = this.parameters.kind || 'Note';
      if (annotation.description) {
        let defaultProp = parseDescription(annotation.description);
        if (defaultProp) {
          clioAnnotation.setProp(defaultProp);
        }
      }
    }

    clioAnnotation.roundPos();
    clioAnnotation.update();

    return super.add(annotation, commit);
  }

  update(reference: AnnotationReference, newAnnotation: Annotation) {
    const annotationRef = new ClioAnnotationFacade(newAnnotation);
    annotationRef.roundPos();
    annotationRef.update();

    super.update(reference, newAnnotation);
  }

  invalidateCache() {
    this.references.forEach((ref) => {
      ref.dispose();
    });
    this.references.clear();
    this.childRefreshed.dispatch();
    this.metadataChunkSource.invalidateCache();
    for (let sources1 of this.getSources({
      multiscaleToViewTransform: new Float32Array(),
      displayRank: 1,
      modelChannelDimensionIndices: [],
    })) {
      for (let source of sources1) {
        source.chunkSource.invalidateCache();
      }
    }
    for (let source of this.segmentFilteredSources) {
      source.invalidateCache();
    }
    // this.childRefreshed.dispatch();
  }
}

async function getAnnotationChunkSource(options: GetDataSourceOptions, sourceParameters: AnnotationSourceParameters, dataInfo: VolumeInfo, credentialsProvider: CredentialsProvider<ClioToken>) {
  let getChunkSource = (dataInfo: any, parameters: any) => options.chunkManager.getChunkSource(
    ClioAnnotationSource, <any>{
    parameters,
    credentialsProvider,
    dataInfo
  });

  return getChunkSource(dataInfo, sourceParameters);
}

async function getAnnotationSource(options: GetDataSourceOptions, sourceParameters: AnnotationSourceParameters, credentialsProvider: CredentialsProvider<ClioToken>) {

  const dataInfo = await getAnnotationDataInfo(sourceParameters);

  const box: BoundingBox = {
    lowerBounds: new Float64Array(dataInfo.lowerVoxelBound),
    upperBounds: Float64Array.from(dataInfo.upperVoxelBound)
  };
  const modelSpace = makeCoordinateSpace({
    rank: 3,
    names: ['x', 'y', 'z'],
    units: ['m', 'm', 'm'],
    scales: Float64Array.from(dataInfo.voxelSize, x => x / 1e9),
    boundingBoxes: [makeIdentityTransformedBoundingBox(box)],
  });

  const annotation = await getAnnotationChunkSource(options, sourceParameters, dataInfo, credentialsProvider);

  const dataSource: DataSource = {
    modelTransform: makeIdentityTransform(modelSpace),
    subsources: [{
      id: 'default',
      subsource: { annotation },
      default: true,
    }],
  };

  return dataSource;
}

//https://us-east4-flyem-private.cloudfunctions.net/mb20?query=value
const urlPattern = /^([^\/]+:\/\/[^\/]+)\/(?:([^\/\?#]+)\/)?([^\/\?#]+)(?:(?:\?|#)(.*))?$/;
// const urlPattern = /^((?:http|https):\/\/[^\/]+)\/([^\/]+)\/([^\/\?#]+)(?:(?:\?|#)(.*))?$/;

function parseSourceUrl(url: string): ClioSourceParameters {
  let match = url.match(urlPattern);
  if (match === null) {
    throw new Error(`Invalid Clio URL: ${JSON.stringify(url)}.`);
  }

  let sourceParameters: ClioSourceParameters = {
    baseUrl: match[1],
    api: match[2],
    dataset: match[3]
  };

  let queryString = match[4];
  if (queryString) {
    let parameters = parseQueryStringParameters(queryString);
    if (parameters.token) {
      sourceParameters.authToken = parameters.token;
      sourceParameters.authServer = 'token:' + parameters.token;
    } else if (parameters.auth) {
      sourceParameters.authServer = parameters.auth;
    }

    if (parameters.user) {
      sourceParameters.user = parameters.user;
    } else if (sourceParameters.authToken) {
      sourceParameters.user = getUserFromToken(sourceParameters.authToken);
    }

    if (parameters.kind) {
      if (parameters.kind === 'atlas') {
        sourceParameters.kind = 'Atlas';
      } else {
        sourceParameters.kind = parameters.kind;
      }
    } else {
      sourceParameters.kind = 'Normal';
    }

    if (parameters.groups) {
      sourceParameters.groups = parameters.groups;
    }
  }

  return sourceParameters;
}

async function completeSourceParameters(sourceParameters: ClioSourceParameters, getCredentialsProvider: (auth:AuthType) => CredentialsProvider<ClioToken>): Promise<ClioSourceParameters> {
  const clioInstance = new ClioInstance(sourceParameters);
  return makeRequestWithCredentials(
    getCredentialsProvider(sourceParameters.authServer),
    isAuthRefreshable(sourceParameters),
    {
      url: clioInstance.getDatasetsUrl(),
      method: 'GET',
      responseType: 'json'
    }).then(response => {
      const grayscaleInfo = verifyObjectProperty(response, sourceParameters.dataset, verifyObject);
      if ('location' in grayscaleInfo) {
        sourceParameters.grayscale = verifyObjectProperty(grayscaleInfo, 'location', verifyString);
      } else if ('mainLayer' in grayscaleInfo) {
        const mainLayer = verifyObjectProperty(grayscaleInfo, 'mainLayer', verifyString);
        const neuroglancer = verifyObjectProperty(grayscaleInfo, 'neuroglancer', verifyObject);
        const layers = neuroglancer.layers;
        const layer = layers.find((layer: {name: string}) => layer.name === mainLayer);
        if (layer.source && layer.source.url) {
          sourceParameters.grayscale = verifyObjectProperty(layer.source, 'url', verifyString);
        } else {
          sourceParameters.grayscale = verifyObjectProperty(layer, 'source', verifyString);
        }
      }

      return sourceParameters;
    });
}

type AuthType = string|undefined|null;

async function getDataSource(options: GetDataSourceOptions, getCredentialsProvider: (auth:AuthType) => CredentialsProvider<ClioToken>): Promise<DataSource> {
  let sourceParameters = parseSourceUrl(options.providerUrl);

  if (!sourceParameters.user && sourceParameters.authServer) {
    let credentials = getCredentialsProvider(sourceParameters.authServer).get();
    sourceParameters.authToken = (await credentials).credentials;
    sourceParameters.user = getUserFromToken(sourceParameters.authToken);
  }

  return options.chunkManager.memoize.getUncounted(
      {
        type: 'clio:MultiscaleVolumeChunkSource',
        ...sourceParameters
      },
      async () => {
        sourceParameters = await completeSourceParameters(sourceParameters, getCredentialsProvider);

        let annotationSourceParameters: AnnotationSourceParameters = {
          ...new AnnotationSourceParameters(),
          ...sourceParameters
        };

        // annotationSourceParameters.schema = getSchema(annotationSourceParameters);

        if (sourceParameters.kind === 'Atlas') {
          annotationSourceParameters.schema = defaultAtlasSchema;
        } else {
          annotationSourceParameters.schema = defaultAnnotationSchema;
        }

        annotationSourceParameters.properties = [{
          identifier: 'rendering_attribute',
          description: 'rendering attribute',
          type: 'int32',
          default: 0,
          min: 0,
          max: 5,
          step: 1
        }];

        // let credentials = sourceParameters.authToken;
        const credentialsProvider = getCredentialsProvider(sourceParameters.authServer);
        return getAnnotationSource(options, annotationSourceParameters, credentialsProvider);
      });
}

async function completeHttpPath(_1: string) {
  return Promise.resolve({
    offset: 0,
    completions: [{value: ''}]
  });
}

//Clio data source provider
export class ClioDataSource extends DataSourceProvider {
  description = 'Clio';
  constructor(public credentialsManager: CredentialsManager) {
    super();
  }

  getCredentialsProvider(authServer: AuthType) {
    let parameters = '';
    if (authServer) {
      parameters = authServer;
    }

    return this.credentialsManager.getCredentialsProvider<ClioToken>(credentialsKey, parameters);
  }

  get(options: GetDataSourceOptions): Promise<DataSource> {
    return getDataSource(options, this.getCredentialsProvider.bind(this));
  }

  completeUrl(options: CompleteUrlOptions) {
    return completeHttpPath(options.providerUrl);
  }
}