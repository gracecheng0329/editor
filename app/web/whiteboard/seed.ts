import { createShapeId, toRichText, type Editor, type TLShapeId } from "tldraw";
import type { ArchitectureNode, NodeKind } from "./architecture-shape";

function connect(editor: Editor, from: TLShapeId, to: TLShapeId, label: string) {
  const start = editor.getShapePageBounds(from)!.center;
  const end = editor.getShapePageBounds(to)!.center;
  const id = createShapeId();
  editor.createShape({ id, type: "arrow", x: start.x, y: start.y, props: {
    start: { x: 0, y: 0 }, end: { x: end.x - start.x, y: end.y - start.y },
    color: "grey", size: "s", font: "sans", richText: toRichText(label),
    arrowheadEnd: "arrow", arrowheadStart: "none", kind: "elbow",
  } });
  editor.createBindings([
    { type: "arrow", fromId: id, toId: from, props: { terminal: "start", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
    { type: "arrow", fromId: id, toId: to, props: { terminal: "end", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
  ]);
}

export const INITIAL_SERVICE_ID = createShapeId("archly-sync-service");

export function seedCanvas(editor: Editor) {
  editor.updateInstanceState({ isGridMode: true });
  editor.user.updateUserPreferences({ colorScheme: "light" });
  if (editor.getCurrentPageShapeIds().size > 0 || editor.getCurrentPage().meta.archlySeeded) return;
  const nodes: { id: TLShapeId; x: number; y: number; title: string; subtitle: string; kind: NodeKind }[] = [
    { id: createShapeId("archly-client"), x: 80, y: 180, title: "Web Client", subtitle: "Next.js · React · tldraw", kind: "client" },
    { id: createShapeId("archly-web"), x: 420, y: 180, title: "Web Application", subtitle: "文件、登入與產品介面", kind: "service" },
    { id: INITIAL_SERVICE_ID, x: 760, y: 180, title: "Sync Service", subtitle: "Cloudflare Durable Objects", kind: "service" },
    { id: createShapeId("archly-db"), x: 420, y: 410, title: "Database", subtitle: "Supabase · PostgreSQL", kind: "database" },
    { id: createShapeId("archly-storage"), x: 760, y: 410, title: "Version Storage", subtitle: "畫布快照與里程碑版本", kind: "storage" },
  ];
  editor.run(() => {
    editor.updatePage({ id: editor.getCurrentPageId(), meta: { ...editor.getCurrentPage().meta, archlySeeded: true } });
    editor.createShapes<ArchitectureNode>(nodes.map((node) => ({ id: node.id, type: "architecture-node", x: node.x, y: node.y, props: { title: node.title, subtitle: node.subtitle, kind: node.kind } })));
    connect(editor, nodes[0].id, nodes[1].id, "HTTPS");
    connect(editor, nodes[1].id, nodes[2].id, "WebSocket");
    connect(editor, nodes[1].id, nodes[3].id, "Auth & Data");
    connect(editor, nodes[2].id, nodes[4].id, "Snapshot");
    editor.createShapes([
      { type: "text", x: 80, y: 28, props: { richText: toRichText("把想法，連成架構。"), font: "sans", size: "xl", color: "black" } },
      { type: "text", x: 84, y: 91, props: { richText: toRichText("COLLABORATIVE WHITEBOARD  /  SYSTEM OVERVIEW"), font: "mono", size: "s", color: "grey", scale: 0.63 } },
      { type: "note", x: 100, y: 393, rotation: -0.035, props: { richText: toRichText("從一個想法開始 ✨\n\n拖曳節點整理架構，\n用連線說明彼此的關係。\n\n這是一份可編輯的範例。"), color: "yellow", font: "sans", size: "s" } },
      { type: "text", x: 420, y: 553, props: { richText: toRichText("產品資料"), font: "sans", size: "s", color: "grey", scale: 0.7 } },
      { type: "text", x: 760, y: 553, props: { richText: toRichText("畫布與版本"), font: "sans", size: "s", color: "grey", scale: 0.7 } },
    ]);
  }, { history: "ignore" });
  const viewport = editor.getViewportScreenBounds();
  const leftInset = viewport.w > 780 ? 295 : 35;
  const z = Math.max(0.2, Math.min(0.95, (viewport.w - leftInset - 35) / 1000, (viewport.h - 260) / 620));
  editor.setCamera({ x: leftInset / z - 80, y: 145 / z - 28, z });
}
