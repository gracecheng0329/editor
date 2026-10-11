"use client";

import { Database, Globe, HardDrive, Layers3, Server, type LucideIcon } from "lucide-react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  useEditor,
  useValue,
  type TLShape,
} from "tldraw";

export const NODE_KINDS = {
  client: { label: "用戶端", description: "Web 與行動裝置", icon: Globe, color: "blue" },
  service: { label: "服務", description: "API 與應用程式", icon: Server, color: "purple" },
  database: { label: "資料庫", description: "結構化資料儲存", icon: Database, color: "green" },
  storage: { label: "儲存空間", description: "檔案與物件儲存", icon: HardDrive, color: "orange" },
  queue: { label: "訊息佇列", description: "事件與非同步任務", icon: Layers3, color: "pink" },
} satisfies Record<string, { label: string; description: string; icon: LucideIcon; color: string }>;

export type NodeKind = keyof typeof NODE_KINDS;

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    "architecture-node": { w: number; h: number; title: string; subtitle: string; kind: NodeKind };
  }
}

export type ArchitectureNode = TLShape<"architecture-node">;

function NodeContent({ shape }: { shape: ArchitectureNode }) {
  const editor = useEditor();
  const editing = useValue("editing architecture node", () => editor.getEditingShapeId() === shape.id, [editor, shape.id]);
  const definition = NODE_KINDS[shape.props.kind];
  const Icon = definition.icon;
  return (
    <HTMLContainer className={`architecture-node node-${definition.color}`} style={{ width: shape.props.w, height: shape.props.h }}>
      <div className="node-symbol"><Icon size={23} strokeWidth={1.7} /></div>
      <div className="node-copy">
        {editing ? (
          <input autoFocus aria-label="節點名稱" value={shape.props.title} style={{ pointerEvents: "all" }}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => editor.updateShape<ArchitectureNode>({ id: shape.id, type: shape.type, props: { title: event.target.value } })}
            onBlur={() => editor.setEditingShape(null)}
            onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter" || event.key === "Escape") editor.setEditingShape(null); }}
          />
        ) : <strong>{shape.props.title || "未命名節點"}</strong>}
        <span>{shape.props.subtitle}</span>
      </div>
      <span className="node-port port-left" /><span className="node-port port-right" />
    </HTMLContainer>
  );
}

export class ArchitectureNodeUtil extends BaseBoxShapeUtil<ArchitectureNode> {
  static override type = "architecture-node" as const;
  static override props = { w: T.number, h: T.number, title: T.string, subtitle: T.string, kind: T.literalEnum("client", "service", "database", "storage", "queue") };
  getDefaultProps(): ArchitectureNode["props"] {
    return { w: 216, h: 98, title: "應用服務", subtitle: "描述這個元件的職責", kind: "service" };
  }
  override canEdit() { return true; }
  component(shape: ArchitectureNode) { return <NodeContent shape={shape} />; }
  getIndicatorPath(shape: ArchitectureNode) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 12);
    return path;
  }
}

export const architectureShapeUtils = [ArchitectureNodeUtil];
