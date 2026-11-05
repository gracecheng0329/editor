import { createTLSchema, defaultShapeSchemas } from '@tldraw/tlschema';
import { T } from '@tldraw/validate';

/** One schema definition used by the client shape util and authoritative room. */
export const architectureNodeProps = {
  w: T.number, h: T.number, title: T.string, subtitle: T.string,
  kind: T.literalEnum('client', 'service', 'database', 'storage', 'queue'),
};
export const canvasSchema = createTLSchema({ shapes: {
  ...defaultShapeSchemas,
  'architecture-node': { props: architectureNodeProps },
} });
