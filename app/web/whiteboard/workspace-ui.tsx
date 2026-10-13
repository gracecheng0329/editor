"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp,
  Clock3, CloudOff, Command, Eraser, Eye, GitBranch, Hand, History, LayoutGrid, Link2,
  LockKeyhole, Maximize, MessageCircle, Minus, MousePointer2, MoveUpRight, Pencil,
  Plus, Redo2, Search, Send, ShieldCheck, SlidersHorizontal, Sparkles, Square,
  StickyNote, Type, Undo2, Users, X, type LucideIcon,
} from "lucide-react";
import {
  DefaultColorStyle, DefaultSizeStyle, getSnapshot, Tldraw, track, useEditor,
  createShapeId, type TLShapeId,
} from "tldraw";
import { architectureShapeUtils, NODE_KINDS, type ArchitectureNode, type NodeKind } from "./architecture-shape";
import { INITIAL_SERVICE_ID } from "./seed";

type Message = { id: string; body: string; author: string; time: string };
type Thread = { id: string; shapeId?: TLShapeId; x: number; y: number; resolved: boolean; messages: Message[] };
type Milestone = { id: string; name: string; date: string; document: ReturnType<typeof getSnapshot>["document"] };
type Panel = "comments" | "versions" | null;
type Modal = "share" | "help" | null;

const defaultThreads: Thread[] = [{
  id: "example-thread", shapeId: INITIAL_SERVICE_ID, x: 950, y: 195, resolved: false,
  messages: [{ id: "example-message", body: "同步服務與產品資料各有自己的權威來源，讓畫布保持單一同步引擎。\n\n試著在下方留言，一起完善這份架構。", author: "範例導覽", time: "示範留言" }],
}];

function useLocalData<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try { const stored = window.localStorage.getItem(key); return stored === null ? initial : JSON.parse(stored); }
    catch { return initial; }
  });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(value)); }
    catch { queueMicrotask(() => setFailed(true)); }
  }, [key, value]);
  return [value, setValue, failed] as const;
}

function IconButton({ icon: Icon, label, active, onClick, className = "", disabled = false }: { icon: LucideIcon; label: string; active?: boolean; onClick?: () => void; className?: string; disabled?: boolean }) {
  return <button className={`icon-button ${active ? "is-active" : ""} ${className}`} title={label} aria-label={label} aria-pressed={active} onClick={onClick} disabled={disabled}><Icon size={19} strokeWidth={1.75} /></button>;
}

function ModalFrame({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const items = closeRef.current?.closest('[role="dialog"]')?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, a[href], [tabindex="0"]');
        if (!items?.length) return;
        const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); if (previous instanceof HTMLElement) previous.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="panel-header"><h2>{title}</h2><button ref={closeRef} className="icon-button" aria-label="關閉對話框" onClick={onClose}><X size={19} /></button></header>
      {children}
    </section>
  </div>;
}

export const WorkspaceUi = track(function WorkspaceUi() {
  const editor = useEditor();
  const [title, setTitle, titleFailed] = useLocalData("archly-local-title-v1", "協作白板 · 系統架構");
  const [threads, setThreads, threadsFailed] = useLocalData<Thread[]>("archly-local-threads-v1", defaultThreads);
  const [milestones, setMilestones, versionsFailed] = useLocalData<Milestone[]>("archly-local-milestones-v1", []);
  const [library, setLibrary] = useState(() => window.innerWidth > 780);
  const searchRef = useRef<HTMLInputElement>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("open");
  const [draft, setDraft] = useState("");
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [milestoneName, setMilestoneName] = useState("");
  const [preview, setPreview] = useState<Milestone | null>(null);
  const [notice, setNotice] = useState("");
  const [starred, setStarred] = useLocalData("archly-local-star-v1", false);
  const [fileMenu, setFileMenu] = useState(false);
  const currentTool = editor.getCurrentToolId();
  const selected = editor.getSelectedShapes();
  const selectedNode = selected.length === 1 && selected[0].type === "architecture-node" ? selected[0] : null;
  const openThreads = threads.filter((thread) => !thread.resolved);
  const closeModal = useCallback(() => setModal(null), []);
  const closePreview = useCallback(() => setPreview(null), []);
  const visibleThreads = threads.filter((thread) => filter === "all" || (filter === "resolved" ? thread.resolved : !thread.resolved));

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => editor.sideEffects.registerBeforeDeleteHandler("shape", (shape) => {
    const bounds = editor.getShapePageBounds(shape.id);
    if (bounds) setThreads((current) => current.map((thread) => thread.shapeId === shape.id ? { ...thread, x: bounds.maxX - 14, y: bounds.y + 14 } : thread));
  }), [editor, setThreads]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (modal || preview || editor.getEditingShapeId() || target?.isContentEditable || target?.closest("input, textarea, select")) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "k") {
        event.preventDefault(); setLibrary(true);
        window.requestAnimationFrame(() => searchRef.current?.focus());
        return;
      }
      if (modifier && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) editor.redo(); else editor.undo(); return; }
      if (modifier) return;
      const tools: Record<string, string> = { v: "select", h: "hand", p: "draw", e: "eraser", a: "arrow", t: "text", n: "note", r: "geo" };
      if (tools[event.key.toLowerCase()]) { event.preventDefault(); editor.setCurrentTool(tools[event.key.toLowerCase()]); }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); editor.deleteShapes(editor.getSelectedShapeIds()); }
      if (event.key.toLowerCase() === "c") { setPanel("comments"); setActiveThread(null); }
      if (event.key === "Escape") { editor.setCurrentTool("select"); editor.selectNone(); setFileMenu(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, modal, preview]);

  function addNode(kind: NodeKind) {
    const definition = NODE_KINDS[kind];
    const center = editor.getViewportPageBounds().center;
    const id = createShapeId();
    editor.markHistoryStoppingPoint("add architecture node");
    editor.createShape<ArchitectureNode>({ id, type: "architecture-node", x: center.x - 108, y: center.y - 49, props: { title: definition.label, subtitle: definition.description, kind } });
    editor.setCurrentTool("select"); editor.select(id);
    setNotice(`已新增${definition.label}，雙擊即可命名`);
  }

  function postComment() {
    if (!draft.trim()) return;
    const message: Message = { id: crypto.randomUUID(), body: draft.trim(), author: "你", time: new Date().toISOString() };
    if (activeThread && threads.some((thread) => thread.id === activeThread)) {
      setThreads((current) => current.map((thread) => thread.id === activeThread ? { ...thread, messages: [...thread.messages, message] } : thread));
    } else {
      const bounds = selected.length === 1 ? editor.getShapePageBounds(selected[0].id) : null;
      const center = editor.getViewportPageBounds().center;
      const thread: Thread = { id: crypto.randomUUID(), shapeId: bounds ? selected[0].id : undefined, x: bounds ? bounds.maxX - 14 : center.x, y: bounds ? bounds.y + 14 : center.y, resolved: false, messages: [message] };
      setThreads((current) => [...current, thread]); setActiveThread(thread.id);
    }
    setDraft(""); setNotice("已新增本機留言，尚未同步至雲端");
  }

  function saveMilestone() {
    if (!milestoneName.trim()) return;
    const { document } = getSnapshot(editor.store);
    const version: Milestone = { id: crypto.randomUUID(), name: milestoneName.trim(), date: new Date().toISOString(), document };
    setMilestones((current) => [version, ...current]); setMilestoneName("");
    setNotice("已建立本機里程碑，可唯讀預覽");
  }

  function fitCanvas() {
    const bounds = editor.getCurrentPageBounds();
    if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 250 }, inset: 100 });
  }
  const toolbar: { tool: string; label: string; shortcut: string; icon: LucideIcon }[] = [
    { tool: "select", label: "選取", shortcut: "V", icon: MousePointer2 },
    { tool: "hand", label: "平移", shortcut: "H", icon: Hand },
    { tool: "draw", label: "自由手繪", shortcut: "P", icon: Pencil },
    { tool: "eraser", label: "整筆橡皮擦", shortcut: "E", icon: Eraser },
    { tool: "note", label: "便利貼", shortcut: "N", icon: StickyNote },
    { tool: "geo", label: "形狀", shortcut: "R", icon: Square },
    { tool: "arrow", label: "方向連線", shortcut: "A", icon: MoveUpRight },
    { tool: "text", label: "文字", shortcut: "T", icon: Type },
  ];

  return <div className="workspace-ui" onPointerDown={(event) => event.stopPropagation()}>
    <header className="document-bar floating-surface">
      <button className="brand" aria-label="文件選單" aria-expanded={fileMenu} onClick={() => setFileMenu(!fileMenu)}><span className="brand-mark">a</span><span className="brand-word">archly<span>✳</span></span><ChevronDown size={13} /></button>
      <span className="divider" />
      <div className="document-heading"><input aria-label="文件名稱" value={title} onChange={(event) => setTitle(event.target.value)} /><span><LockKeyhole size={10} /> 本機文件 <span className="heading-dot">·</span> 僅儲存於此裝置</span></div>
      <IconButton icon={Sparkles} label={starred ? "取消收藏" : "收藏文件"} active={starred} onClick={() => setStarred(!starred)} className="favorite-button" />
    </header>

    {fileMenu && <div className="file-menu floating-surface"><span className="eyebrow">你的工作空間</span><button onClick={() => { setLibrary(!library); setFileMenu(false); }}><LayoutGrid size={16} />{library ? "隱藏" : "顯示"}元件庫</button><button onClick={() => { setPanel("versions"); setFileMenu(false); }}><History size={16} />版本歷史</button><button onClick={() => { fitCanvas(); setFileMenu(false); }}><Maximize size={16} />縮放至全部內容</button><button onClick={() => { setModal("help"); setFileMenu(false); }}><CircleHelp size={16} />操作指南與開發狀態</button></div>}

    <div className="collaboration-bar floating-surface">
      <span className="local-status" title="本機介面預覽，Cloudflare 與 Supabase 尚未串接"><CloudOff size={14} />本機模式</span>
      <span className="divider" />
      <button className="avatar" aria-label="目前使用者與協作狀態" onClick={() => setModal("share")}>你</button>
      <IconButton icon={MessageCircle} label="留言討論" active={panel === "comments"} onClick={() => setPanel(panel === "comments" ? null : "comments")} />
      <IconButton icon={History} label="版本歷史" active={panel === "versions"} onClick={() => setPanel(panel === "versions" ? null : "versions")} />
      <button className="primary-button share-button" onClick={() => setModal("share")}><Users size={16} />分享<ChevronDown size={13} /></button>
    </div>

    <button className={`library-toggle floating-surface ${library ? "hidden-toggle" : ""}`} aria-label="開啟元件庫" onClick={() => setLibrary(true)}><LayoutGrid size={19} /></button>
    {library && <aside className="component-library floating-surface" aria-label="架構元件庫">
      <header className="library-header"><div><span className="eyebrow">BUILD YOUR IDEAS</span><h2>架構元件</h2></div><IconButton icon={ChevronLeft} label="收合元件庫" onClick={() => setLibrary(false)} /></header>
      <label className="search-field"><Search size={15} /><input ref={searchRef} aria-label="搜尋元件" placeholder="搜尋元件…" value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>⌘ K</kbd></label>
      <div className="library-tabs"><button className="selected">基礎元件</button><span>點選加入畫布</span></div>
      <div className="component-list">{Object.entries(NODE_KINDS).filter(([key, value]) => `${key} ${value.label} ${value.description}`.toLowerCase().includes(search.toLowerCase())).map(([kind, value]) => <button key={kind} className="component-item" onClick={() => addNode(kind as NodeKind)}><span className={`component-icon node-${value.color}`}><value.icon size={20} strokeWidth={1.7} /></span><span><strong>{value.label}</strong><small>{value.description}</small></span><Plus size={15} className="component-add" /></button>)}
        {Object.entries(NODE_KINDS).every(([key, value]) => !`${key} ${value.label} ${value.description}`.toLowerCase().includes(search.toLowerCase())) && <p className="empty-search">找不到符合的元件</p>}
      </div>
      <div className="library-section"><span className="eyebrow">讓想法更清楚</span><button onClick={() => editor.setCurrentTool("note")}><StickyNote size={17} /><span>便利貼</span><kbd>N</kbd></button><button onClick={() => editor.setCurrentTool("text")}><Type size={17} /><span>文字說明</span><kbd>T</kbd></button><button onClick={() => { setPanel("comments"); setActiveThread(null); }}><MessageCircle size={17} /><span>錨定留言</span><kbd>C</kbd></button></div>
      <div className="library-tip"><span className="tip-symbol">✦</span><div><strong>留一點空間給好想法</strong><p>從一個節點開始，用連線讓想法彼此連結。</p></div></div>
      <footer className="library-footer"><GitBranch size={13} />一張畫布，梳理所有可能。</footer>
    </aside>}

    <div className="canvas-comment-pins" aria-label="畫布留言錨點">{openThreads.map((thread, index) => {
      const bounds = thread.shapeId ? editor.getShapePageBounds(thread.shapeId) : null;
      const point = editor.pageToScreen(bounds ? { x: bounds.maxX - 14, y: bounds.y + 14 } : { x: thread.x, y: thread.y });
      const viewport = editor.getViewportScreenBounds();
      return <button key={thread.id} className={`comment-pin ${activeThread === thread.id ? "selected" : ""}`} style={{ left: point.x - viewport.x, top: point.y - viewport.y }} aria-label={`開啟討論串 ${index + 1}`} onClick={() => { setPanel("comments"); setActiveThread(thread.id); }}>{index + 1}</button>;
    })}</div>

    {selectedNode && <div className="selection-inspector floating-surface"><SlidersHorizontal size={15} /><label>節點名稱<input aria-label="編輯選取節點名稱" value={selectedNode.props.title} onChange={(event) => editor.updateShape<ArchitectureNode>({ id: selectedNode.id, type: selectedNode.type, props: { title: event.target.value } })} /></label></div>}

    {panel && <aside className="side-panel floating-surface" aria-label={panel === "comments" ? "留言面板" : "版本面板"}>
      <header className="panel-header"><h2>{panel === "comments" ? <><MessageCircle size={18} />留言討論 <span className="count-badge">{openThreads.length}</span></> : <><History size={18} />版本歷史</>}</h2><IconButton icon={X} label="關閉側欄" onClick={() => setPanel(null)} /></header>
      <div className="panel-local-note"><CloudOff size={13} />本機預覽 · 尚未同步至雲端</div>
      {panel === "comments" ? <>
        <div className="panel-tabs">{[{ id: "open", label: "未解決" }, { id: "resolved", label: "已解決" }, { id: "all", label: "全部" }].map((tab) => <button key={tab.id} className={filter === tab.id ? "selected" : ""} onClick={() => setFilter(tab.id)}>{tab.label}</button>)}</div>
        <div className="thread-list">{visibleThreads.map((thread) => <article key={thread.id} className={`thread-card ${activeThread === thread.id ? "selected" : ""}`}>
          <button className="thread-anchor" onClick={() => { setActiveThread(thread.id); if (thread.shapeId && editor.getShape(thread.shapeId)) { editor.select(thread.shapeId); editor.zoomToSelection({ animation: { duration: 200 } }); } }}><Link2 size={12} />{thread.shapeId ? editor.getShape(thread.shapeId) ? "物件留言" : "原物件已移除" : "畫布座標留言"}<ArrowUpRight size={12} /></button>
          {thread.messages.map((message) => <div className="comment-message" key={message.id}><span className={`message-avatar ${message.author === "你" ? "own" : ""}`}>{message.author === "你" ? "你" : "a"}</span><div><div className="message-meta"><strong>{message.author}</strong><time>{message.time === "示範留言" ? message.time : new Date(message.time).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</time></div><p>{message.body}</p></div></div>)}
          <div className="thread-actions"><button onClick={() => setActiveThread(thread.id)}><MessageCircle size={13} />回覆</button><button onClick={() => setThreads((current) => current.map((item) => item.id === thread.id ? { ...item, resolved: !item.resolved } : item))}><Check size={14} />{thread.resolved ? "重新開啟" : "標記已解決"}</button></div>
        </article>)}{visibleThreads.length === 0 && <div className="panel-empty"><MessageCircle size={28} /><h3>{filter === "resolved" ? "還沒有已解決的討論" : "讓討論從這裡開始"}</h3><p>選取物件或直接留言，記錄你的想法。</p></div>}</div>
        <form className="comment-composer" onSubmit={(event) => { event.preventDefault(); postComment(); }}><div className="composer-heading"><span>{activeThread ? "回覆討論串" : selected.length === 1 ? "在選取物件上留言" : "新增畫布座標留言"}</span>{activeThread && <button type="button" onClick={() => setActiveThread(null)}>改為新討論</button>}</div><textarea aria-label="留言內容" placeholder="分享你的想法…" value={draft} onChange={(event) => setDraft(event.target.value)} /><div className="composer-footer"><span>留言僅保留於此瀏覽器</span><button className="primary-button" type="submit" disabled={!draft.trim()} aria-label="送出留言"><Send size={14} />送出</button></div></form>
      </> : <>
        <div className="version-intro"><span className="version-intro-icon"><GitBranch size={23} /></span><h3>為好想法，留個里程碑。</h3><p>保存此刻的畫布，隨時唯讀回看。</p></div>
        <form className="milestone-form" onSubmit={(event) => { event.preventDefault(); saveMilestone(); }}><label htmlFor="milestone-name">里程碑名稱</label><input id="milestone-name" placeholder="例如：第一版架構提案" value={milestoneName} onChange={(event) => setMilestoneName(event.target.value)} /><button className="primary-button" disabled={!milestoneName.trim()}><Plus size={15} />建立本機里程碑</button></form>
        <div className="version-list">{milestones.map((milestone) => <button className="version-item" key={milestone.id} onClick={() => setPreview(milestone)}><span className="version-dot" /><span><strong>{milestone.name}</strong><small>{new Date(milestone.date).toLocaleString("zh-TW")}</small></span><Eye size={17} /></button>)}{!milestones.length && <p className="muted centered">尚未建立里程碑版本</p>}</div>
        <div className="pending-feature"><Clock3 size={16} /><p>自動快照、安全還原與保留政策將於 S5 串接；本機里程碑不是雲端備份。</p></div>
      </>}
    </aside>}

    <div className="bottom-bar">
      <div className="history-controls floating-surface"><IconButton icon={Undo2} label="復原 ⌘Z" onClick={() => editor.undo()} disabled={!editor.getCanUndo()} /><IconButton icon={Redo2} label="重做 ⇧⌘Z" onClick={() => editor.redo()} disabled={!editor.getCanRedo()} /></div>
      <nav className="drawing-toolbar floating-surface" aria-label="畫布工具列">{toolbar.map(({ tool, label, shortcut, icon: Icon }, index) => <button key={tool} className={`tool-button ${currentTool === tool ? "selected" : ""} ${index === 4 ? "tool-group-start" : ""}`} aria-label={`${label} ${shortcut}`} aria-pressed={currentTool === tool} title={`${label} (${shortcut})`} onClick={() => editor.setCurrentTool(tool)}><Icon size={23} strokeWidth={1.65} /><span className="tool-shortcut">{shortcut}</span></button>)}<span className="divider" /><IconButton icon={MessageCircle} label="新增留言 C" active={panel === "comments"} onClick={() => { setPanel("comments"); setActiveThread(null); }} /><IconButton icon={Plus} label="更多架構元件" onClick={() => setLibrary(!library)} /></nav>
    </div>
    {(currentTool === "draw" || currentTool === "arrow" || currentTool === "geo") && <div className="style-popover floating-surface" aria-label="筆畫樣式"><span>顏色</span>{([{ value: "black", css: "#33323b" }, { value: "violet", css: "#8652e8" }, { value: "blue", css: "#477dec" }, { value: "green", css: "#4c9e77" }, { value: "red", css: "#e37879" }] as const).map((color) => <button key={color.value} className={`color-swatch ${editor.getStyleForNextShape(DefaultColorStyle) === color.value ? "selected" : ""}`} style={{ backgroundColor: color.css }} aria-label={`筆畫顏色 ${color.value}`} onClick={() => { editor.setStyleForNextShapes(DefaultColorStyle, color.value); editor.setStyleForSelectedShapes(DefaultColorStyle, color.value); }} />)}<span className="divider" />{(["s", "m", "l"] as const).map((size, index) => <button key={size} className={`width-swatch ${editor.getStyleForNextShape(DefaultSizeStyle) === size ? "selected" : ""}`} aria-label={`筆畫粗細 ${size}`} onClick={() => editor.setStyleForNextShapes(DefaultSizeStyle, size)}><span style={{ height: index * 2 + 2 }} /></button>)}</div>}
    <div className="canvas-footer"><span><span className="footer-dot" />自由探索，盡情連結。</span><button onClick={() => setModal("help")}><Command size={12} />鍵盤快捷鍵</button></div>
    <div className="zoom-controls floating-surface"><IconButton icon={Minus} label="縮小畫布" onClick={() => editor.zoomOut(undefined, { animation: { duration: 150 } })} /><button className="zoom-percentage" aria-label="縮放至全部內容" onClick={fitCanvas}>{Math.round(editor.getZoomLevel() * 100)}%</button><IconButton icon={Plus} label="放大畫布" onClick={() => editor.zoomIn(undefined, { animation: { duration: 150 } })} /><span className="divider" /><IconButton icon={Maximize} label="檢視全部內容" onClick={fitCanvas} /></div>
    <button className="help-button floating-surface" aria-label="操作指南" onClick={() => setModal("help")}><CircleHelp size={19} /></button>
    {(titleFailed || threadsFailed || versionsFailed) && <div className="storage-warning" role="alert">瀏覽器儲存空間不可用，部分本機資料可能無法保留。請勿關閉頁面。</div>}
    {notice && <div className="toast floating-surface" role="status"><CheckCheck size={16} />{notice}</div>}

    {modal === "share" && <ModalFrame title="一起把想法連起來" onClose={closeModal}><div className="share-modal-body"><div className="share-illustration"><span className="avatar">你</span><span className="share-dashed-line" /><span className="invite-avatar"><Plus size={22} /></span></div><p className="modal-description">邀請編輯者共同構思，或用唯讀連結分享架構。</p><div className="connection-notice"><CloudOff size={18} /><div><strong>目前為本機介面預覽</strong><p>尚未連接 Supabase 登入與 Cloudflare 同步服務，文件沒有公開，也沒有可用的分享連結。</p></div></div><label className="field-label">邀請已註冊的 GitHub 使用者</label><div className="invite-field"><input placeholder="GitHub 使用者名稱" disabled /><button className="primary-button" disabled>邀請</button></div><div className="access-row"><LockKeyhole size={17} /><div><strong>連結存取權</strong><span>雲端分享尚未啟用</span></div><button disabled>唯讀 <ChevronDown size={12} /></button></div><button className="secondary-button full-width" disabled><Link2 size={15} />分享連結待串接</button><p className="share-footnote"><ShieldCheck size={13} />正式版本將由伺服器驗證權限，支援邀請與撤權。</p></div></ModalFrame>}
    {modal === "help" && <ModalFrame title="給好想法一個空間" onClose={closeModal}><div className="help-content"><p className="modal-description">參考 FigJam 的輕量浮動介面，為系統架構討論而設計。</p><div className="shortcut-grid">{toolbar.map((tool) => <div key={tool.tool}><span>{tool.label}</span><kbd>{tool.shortcut}</kbd></div>)}<div><span>復原／重做</span><kbd>⌘ Z</kbd></div><div><span>刪除物件</span><kbd>⌫</kbd></div></div><div className="connection-notice"><CloudOff size={18} /><div><strong>目前可操作</strong><p>本機節點、連線、文字、手繪、畫布操作、留言與里程碑預覽。雙擊節點修改名稱。</p><strong>接下來串接</strong><p>GitHub 登入、多人游標、雲端保存、權限、留言即時更新與安全版本還原。此介面不代表 G0／S1–S5 驗收完成。</p></div></div></div></ModalFrame>}
    {preview && <ModalFrame title={`版本預覽 · ${preview.name}`} onClose={closePreview} wide><div className="preview-note"><Eye size={14} />唯讀本機快照 · 不影響目前畫布</div><div className="milestone-preview"><Tldraw hideUi shapeUtils={architectureShapeUtils} snapshot={preview.document} onMount={(previewEditor) => { previewEditor.updateInstanceState({ isReadonly: true }); const bounds = previewEditor.getCurrentPageBounds(); if (bounds) previewEditor.zoomToBounds(bounds, { inset: 60 }); }} /></div><div className="preview-footer"><span>雲端安全還原尚未串接</span><button className="secondary-button" onClick={closePreview}>返回目前畫布<ChevronRight size={15} /></button></div></ModalFrame>}
  </div>;
});
