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

import {parseUrl} from 'neuroglancer/util/http_request';
import {DefaultTokenType} from 'neuroglancer/datasource/flyem/api';
export {makeRequestWithCredentials} from 'neuroglancer/datasource/flyem/api';
import {ClioSourceParameters} from 'neuroglancer/datasource/clio/base';

export type ClioToken = DefaultTokenType;

export const credentialsKey = 'Clio';

const urlPattern = /^([^\/]+:\/\/[^\/]+)\/([^\/]+)\/([^\/\?]+)(\?.*)?$/;
function parseDVIDSourceUrl(url: string): { baseUrl: string, nodeKey: string, dataInstanceKey: string } {
  let match = url.match(urlPattern);
  if (match === null) {
    throw new Error(`Invalid DVID URL: ${JSON.stringify(url)}.`);
  }

  return {
    baseUrl: match[1],
    nodeKey: match[2],
    dataInstanceKey: match[3],
  };
}

export function getGrayscaleInfoUrl(u: {protocol: string, host: string, path: string}): string {
  if (u.protocol === 'gs') {
    return `https://storage.googleapis.com/${u.host}${u.path}/info`;
  }else if (u.protocol === 'dvid') {
    const sourceParameters = parseDVIDSourceUrl(u.host + u.path);
    return `${sourceParameters.baseUrl}/api/node/${sourceParameters.nodeKey}/${sourceParameters.dataInstanceKey}/info`;
  }

  throw Error("Unrecognized volume information");
}

export class ClioInstance {
  constructor(public parameters: ClioSourceParameters) {}

  getTopLevelUrl(): string {
    const {baseUrl, api} = this.parameters;
    return `${baseUrl}/${api || 'clio_toplevel'}`;
  }

  getDatasetsUrl(): string {
    return `${this.getTopLevelUrl()}/datasets`;
  }

  getGrayscaleInfoUrl(): string {
    const u = parseUrl(this.parameters.grayscale!);

    return getGrayscaleInfoUrl(u);
  }

  getAnnotationEndpoint(): string {
    return this.parameters.kind === 'Atlas' ? 'atlas' : 'annotations';
  }

  getAnnotationEntryUrl(): string {
    return `${this.getTopLevelUrl()}/${this.getAnnotationEndpoint()}/${this.parameters.dataset}`;
  }
  getAllAnnotationsUrl(): string {
    return this.getAnnotationEntryUrl();
  }

  getAnnotationUrl(position: ArrayLike<number|string>): string {
    return `${this.getAnnotationEntryUrl()}?x=${position[0]}&y=${position[1]}&z=${position[2]}`;
  }
}

export function responseText(response: Response): Promise<any> {
  return response.text();
}

