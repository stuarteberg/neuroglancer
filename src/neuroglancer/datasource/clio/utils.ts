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

import {PointAnnotation, LineAnnotation, defaultJsonSchema, AnnotationFacade} from 'src/neuroglancer/datasource/flyem/annotation';

export type ClioPointAnnotation = PointAnnotation;
export type ClioLineAnnotation = LineAnnotation;

export type ClioAnnotation = ClioPointAnnotation | ClioLineAnnotation;
export class ClioAnnotationFacade extends AnnotationFacade {
};

export function parseDescription(description: string)
{
  let match = description.match(/^\${(.*):JSON}$/);
  if (match) {
    return JSON.parse(match[1]);
  } else {
    return null;
  }
}

export const defaultAnnotationSchema = defaultJsonSchema;

export const defaultAtlasSchema = {
  "definitions": {},
  "type": "object",
  "required": [
    "Prop"
  ],
  "properties": {
    "Prop": {
      "$id": "#/properties/Prop",
      "type": "object",
      "title": "Properties",
      "required": [
        "title", "comment"
      ],
      "properties": {
        "title": {
          "$id": "#/properties/Prop/properties/title",
          "type": "string",
          "title": "Title",
          "default": ""
        },
        "comment": {
          "$id": "#/properties/Prop/properties/comment",
          "type": "string",
          "title": "Description",
          "default": ""
        }
      }
    }
  }
};

/*
export const defaultAtlasSchema = {
  "definitions": {},
  "type": "object",
  "required": [
    "Title", "Description"
  ],
  "properties": {
    "Title": {
      "$id": "#/properties/Title",
      "type": "string",
      "title": "Title",
      "default": ""
    },
    "Description": {
      "$id": "#/properties/Description",
      "type": "string",
      "title": "Description",
      "default": ""
    }
  }
};
*/