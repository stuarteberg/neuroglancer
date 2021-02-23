import {Uint64} from 'neuroglancer/util/uint64';
import {registerRPC} from 'neuroglancer/worker_rpc';
import {AnnotationGeometryChunkSource} from 'neuroglancer/annotation/frontend_source';
import {Point, Line, AnnotationBase, Annotation, AnnotationType, AnnotationId, fixAnnotationAfterStructuredCloning} from 'neuroglancer/annotation';

export const ANNOTAIION_COMMIT_ADD_SIGNAL_RPC_ID = 'annotation.add.signal';

registerRPC(ANNOTAIION_COMMIT_ADD_SIGNAL_RPC_ID, function(x) {
  const source = <AnnotationGeometryChunkSource>this.get(x.id);
  const newAnnotation: Annotation|null = fixAnnotationAfterStructuredCloning(x.newAnnotation);
  if (newAnnotation) {
    source.parent.updateReference(newAnnotation);
    source.parent.childAdded.dispatch(newAnnotation);
  }
});

type GConstructor<T> = new (...args: any[]) => T;

export function WithFlyEMProp<TBase extends GConstructor<AnnotationBase>>(Base: TBase) {
  class C extends Base {
    kind?: string;
    source?: string;
    key?: string;
    prop?: { [key: string]: any };
    ext?: { [key: string]: any};
    constructor(...args: any[]) {
      super(...args);
    }
  }

  return C;
}

class TAnnotationBase implements AnnotationBase {
  description?: string|undefined|null;

  id: AnnotationId;
  type: AnnotationType;

  relatedSegments?: Uint64[][];
  properties: any[];
}

class TPoint extends TAnnotationBase implements Point {
  point: Float32Array;
  type: AnnotationType.POINT;
}

class TLine extends TAnnotationBase implements Line {
  pointA: Float32Array;
  pointB: Float32Array;
  type: AnnotationType.LINE;
}

export class PointAnnotation extends WithFlyEMProp(TPoint) {
}

export class LineAnnotation extends WithFlyEMProp(TLine) {
}

export type FlyEMAnnotation = PointAnnotation | LineAnnotation;

export class AnnotationFacade {
  annotation: FlyEMAnnotation;
  constructor(annotation: AnnotationBase) {
    this.annotation = annotation as FlyEMAnnotation;
  }

  get renderingAttribute() {
    return 0;
  }

  updateProperties() {
    this.annotation.properties = [this.renderingAttribute];
  }

  get ext() {
    if (this.annotation.ext === undefined) {
      this.annotation.ext = {};
    }

    return this.annotation.ext;
  }

  get prop() {
    return this.annotation.prop;
  }

  set prop(value: {[key: string]: any}|undefined) {
    this.annotation.prop = value;
  }

  get type() {
    return this.annotation.type;
  }

  get kind() {
    return this.annotation.kind;
  }

  set kind(value) {
    this.annotation.kind = value;
  }

  roundPos() {
    if (this.annotation.type === AnnotationType.POINT) {
      this.annotation.point = this.annotation.point.map(x => Math.round(x));
    } else if (this.annotation.type === AnnotationType.LINE) {
      this.annotation.pointA = this.annotation.pointA.map(x => Math.round(x));
      this.annotation.pointB = this.annotation.pointB.map(x => Math.round(x));
    }
  }

  setProp(prop: { [key: string]: any }) {
    this.prop = {...this.prop, ...prop};
  }

  get user() {
    return this.prop && this.prop.user;
  }

  set user(value) {
    this.setProp({user: value});
  }

  get comment() {
    return this.prop && this.prop.comment;
  }

  get description() {
    return this.comment;
  }

  updatePresentation() {
    if (this.title) {
      this.annotation.description = this.title + ": ";
    } else {
      this.annotation.description = '';
    }

    if (this.description) {
      this.annotation.description += this.description;
    }
  }

  update() {
    this.updatePresentation();
    this.updateProperties();
  }

  set comment(s) {
    this.setProp({comment: s});
    this.updatePresentation();
  }

  updateComment() {
    this.comment = this.annotation.description || '';
    this.annotation.description = undefined;
  }

  get title() {
    return this.prop && this.prop.title;
  }

  set title(s) {
    this.setProp({title: s});
    this.updatePresentation();
  }

  get timestamp() {
    return (this.prop && this.prop.timestamp) ? Number(this.prop.timestamp) : 0;
  }

  addTimeStamp() {
    this.setProp({timestamp: String(Date.now())});
  }

  get checked() {
    return (this.ext && this.ext.verified) || (this.prop && this.prop.checked) || false;
  }

  set checked(c) {
    this.setProp({checked: c});
  }

  get presentation() {
    this.updatePresentation();

    return this.annotation.description || '';
  }

  set presentation(value: string) {
    this.annotation.description = value;
  }
}

export function typeOfAnnotationId(id: AnnotationId) {
  if (id.match(/^-?\d+_-?\d+_-?\d+$/) || id.match(/^Pt-?\d+_-?\d+_-?\d+$/)) {
    return AnnotationType.POINT;
  } else if (id.match(/^-?\d+_-?\d+_-?\d+--?\d+_-?\d+_-?\d+-Line$/) || id.match(/^Ln-?\d+_-?\d+_-?\d+_?\d+_-?\d+_-?\d+/)) {
    return AnnotationType.LINE;
  } else {
    console.log(`Invalid annotation ID for DVID: ${id}`);
    return null;
  }
}

export function getAnnotationId(annotation: FlyEMAnnotation) {
  if (annotation.key) {
    return annotation.key;
  }

  switch (annotation.type) {
    case AnnotationType.POINT:
      return `Pt${annotation.point[0]}_${annotation.point[1]}_${annotation.point[2]}`;
    case AnnotationType.LINE:
      return `Ln${annotation.pointA[0]}_${annotation.pointA[1]}_${annotation.pointA[2]}_${annotation.pointB[0]}_${annotation.pointB[1]}_${annotation.pointB[2]}`;
  }
}

export function isAnnotationIdValid(id: AnnotationId) {
  return typeOfAnnotationId(id) !== null;
}

export function getUserFromToken(token: string, defaultUser?: string) {
  let tokenUser:string|undefined = undefined;

  const payload = token.split('.')[1];
  if (payload) {
    const obj = JSON.parse(window.atob(payload));
    if ('user' in obj) {
      tokenUser = obj['user'];
    } else if ('email' in obj) {
      tokenUser = obj['email'];
    }
  }

  if (tokenUser) {
    if (defaultUser && (defaultUser !== tokenUser)) {
      return undefined;
    }
  } else {
    tokenUser = defaultUser;
  }

  return tokenUser;
}

export const defaultJsonSchema = {
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
        "comment",
      ],
      "properties": {
        "comment": {
          "$id": "#/properties/Prop/properties/comment",
          "type": "string",
          "title": "Comment",
          "default": ""
        }
      }
    }
  }
};