'use client'

import { useState } from 'react'
import {
   createShapeId,
   getArrowInfo,
   renderPlaintextFromRichText,
   type TLArrowShape,
   type TLShapeId,
   toRichText,
   useEditor,
   useValue,
} from 'tldraw'
import type { ArchitectureNode } from '@/app/web/whiteboard/architecture-shape'

/** Editing uses native records and bindings, shared with the authoritative room schema. */
export function ObjectTools() {
   const editor = useEditor()
   const shapes = useValue('canvas objects', () => editor.getCurrentPageShapes(), [editor])
   const selected = useValue('selected object', () => editor.getOnlySelectedShape(), [editor])
   const connections = useValue(
      'connection descriptions',
      () =>
         editor
            .getCurrentPageShapes()
            .filter((shape) => shape.type === 'arrow')
            .map((arrow) => ({
               arrow,
               start: endpoint(arrow, 'start'),
               end: endpoint(arrow, 'end'),
               points: `${worldPoint(arrow, 'start')} → ${worldPoint(arrow, 'end')}`,
            })),
      [editor],
   )
   const nodes = shapes.filter(
      (shape): shape is ArchitectureNode => shape.type === 'architecture-node',
   )
   const [startId, setStartId] = useState('')
   const [endId, setEndId] = useState('')
   const [label, setLabel] = useState('')
   const [text, setText] = useState('')
   const [start, setStart] = useState({ x: 100, y: 100 })
   const [end, setEnd] = useState({ x: 420, y: 100 })
   const [error, setError] = useState('')
   const bounds = selected && editor.getShapeGeometry(selected).bounds
   function connect() {
      // Re-read live shapes: another collaborator may have deleted a selected endpoint.
      const from = startId ? editor.getShape(startId as TLShapeId) : undefined
      const to = endId ? editor.getShape(endId as TLShapeId) : undefined
      if ((startId && !from) || (endId && !to)) {
         setError('節點已刪除，請重新選擇連線端點。')
         return
      }
      const a = from ? editor.getShapePageBounds(from)?.center : start
      const b = to ? editor.getShapePageBounds(to)?.center : end
      if (!a || !b) return
      setError('')
      const id = createShapeId()
      editor.run(() => {
         editor.createShape<TLArrowShape>({
            id,
            type: 'arrow',
            x: a.x,
            y: a.y,
            props: {
               start: { x: 0, y: 0 },
               end: { x: b.x - a.x, y: b.y - a.y },
               richText: toRichText(label),
               arrowheadStart: 'none',
               arrowheadEnd: 'arrow',
            },
         })
         for (const [terminal, node] of [
            ['start', from],
            ['end', to],
         ] as const) {
            if (!node) continue
            editor.createBinding({
               type: 'arrow',
               fromId: id,
               toId: node.id,
               props: {
                  terminal,
                  normalizedAnchor: { x: 0.5, y: 0.5 },
                  isExact: false,
                  isPrecise: false,
               },
            })
         }
         editor.select(id)
      })
   }
   function endpoint(arrow: TLArrowShape, terminal: 'start' | 'end') {
      const binding = editor
         .getBindingsFromShape(arrow, 'arrow')
         .find((item) => item.props.terminal === terminal)
      const node = binding && editor.getShape<ArchitectureNode>(binding.toId)
      if (node) return node.props.title
      return `世界座標 ${worldPoint(arrow, terminal)}`
   }
   function worldPoint(arrow: TLArrowShape, terminal: 'start' | 'end') {
      const info = getArrowInfo(editor, arrow)
      const point = editor
         .getShapePageTransform(arrow)
         .applyToPoint(info?.[terminal].point ?? arrow.props[terminal])
      return `(${Math.round(point.x)}, ${Math.round(point.y)})`
   }
   return (
      <>
         <fieldset className='canvas-navigation'>
            <legend>畫布操作</legend>
            {[
               ['select', '選取工具'],
               ['arrow', '連線工具'],
               ['text', '文字工具'],
               ['hand', '平移工具'],
            ].map(([tool, title]) => (
               <button key={tool} type='button' onClick={() => editor.setCurrentTool(tool)}>
                  {title}
               </button>
            ))}
            <button type='button' onClick={() => editor.zoomIn()}>
               放大
            </button>
            <button type='button' onClick={() => editor.zoomOut()}>
               縮小
            </button>
            <button type='button' onClick={() => editor.zoomToFit()}>
               檢視全部
            </button>
         </fieldset>
         <fieldset>
            <legend>有向連線</legend>
            {(['start', 'end'] as const).map((terminal) => {
               const isStart = terminal === 'start'
               const id = isStart ? startId : endId
               const point = isStart ? start : end
               const setPoint = isStart ? setStart : setEnd
               const title = isStart ? '連線起點' : '連線終點'
               return (
                  <div key={terminal}>
                     <label>
                        {title}
                        <select
                           aria-label={title}
                           value={id}
                           onChange={(event) =>
                              (isStart ? setStartId : setEndId)(event.target.value)
                           }
                        >
                           <option value=''>世界座標</option>
                           {id && !nodes.some((node) => node.id === id) && (
                              <option value={id} disabled>
                                 節點已刪除，請重新選擇
                              </option>
                           )}
                           {nodes.map((node) => (
                              <option key={node.id} value={node.id}>
                                 {node.props.title}
                              </option>
                           ))}
                        </select>
                     </label>
                     {!id &&
                        (['x', 'y'] as const).map((axis) => (
                           <label key={axis}>
                              {title} {axis}
                              <input
                                 type='number'
                                 aria-label={`${title} ${axis}`}
                                 value={point[axis]}
                                 onChange={(event) => {
                                    if (
                                       event.target.value !== '' &&
                                       Number.isFinite(event.target.valueAsNumber)
                                    )
                                       setPoint({ ...point, [axis]: event.target.valueAsNumber })
                                 }}
                              />
                           </label>
                        ))}
                  </div>
               )
            })}
            <label>
               新增連線標籤
               <input
                  aria-label='新增連線標籤'
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
               />
            </label>
            <button type='button' onClick={connect}>
               新增連線
            </button>
            {error && <p role='alert'>{error}</p>}
         </fieldset>
         <label>
            新增文字內容
            <input
               aria-label='新增文字內容'
               value={text}
               onChange={(event) => setText(event.target.value)}
            />
         </label>
         <button
            type='button'
            disabled={!text.trim()}
            onClick={() => {
               const id = createShapeId()
               const center = editor.getViewportPageBounds().center
               editor
                  .createShape({
                     id,
                     type: 'text',
                     x: center.x - 120,
                     y: center.y,
                     props: { richText: toRichText(text), w: 240, autoSize: false },
                  })
                  .select(id)
            }}
         >
            新增文字
         </button>
         {selected && (
            <fieldset>
               <legend>選取物件</legend>
               {(selected.type === 'text' || selected.type === 'arrow') && (
                  <label>
                     {selected.type === 'text' ? '選取文字內容' : '選取連線標籤'}
                     <input
                        aria-label={selected.type === 'text' ? '選取文字內容' : '選取連線標籤'}
                        value={renderPlaintextFromRichText(editor, selected.props.richText)}
                        onChange={(event) =>
                           editor.updateShape({
                              id: selected.id,
                              type: selected.type,
                              props: { richText: toRichText(event.target.value) },
                           })
                        }
                     />
                  </label>
               )}
               {(['x', 'y'] as const).map((axis) => (
                  <label key={axis}>
                     物件 {axis}
                     <input
                        aria-label={`物件 ${axis}`}
                        type='number'
                        value={selected[axis]}
                        onChange={(event) => {
                           if (
                              event.target.value !== '' &&
                              Number.isFinite(event.target.valueAsNumber)
                           )
                              editor.updateShape({
                                 id: selected.id,
                                 type: selected.type,
                                 [axis]: event.target.valueAsNumber,
                              })
                        }}
                     />
                  </label>
               ))}
               {bounds &&
                  (['w', 'h'] as const).map((axis) => (
                     <label key={axis}>
                        {axis === 'w' ? '物件寬度' : '物件高度'}
                        <input
                           aria-label={axis === 'w' ? '物件寬度' : '物件高度'}
                           type='number'
                           min='1'
                           value={Math.round(bounds[axis])}
                           onChange={(event) => {
                              const value = event.target.valueAsNumber
                              if (!Number.isFinite(value) || value <= 0 || bounds[axis] <= 0) return
                              if (selected.type === 'architecture-node') {
                                 editor.updateShape<ArchitectureNode>({
                                    id: selected.id,
                                    type: selected.type,
                                    props: { [axis]: value },
                                 })
                              } else {
                                 editor.resizeShape(
                                    selected,
                                    {
                                       x: axis === 'w' ? value / bounds.w : 1,
                                       y: axis === 'h' ? value / bounds.h : 1,
                                    },
                                    {
                                       scaleOrigin: editor
                                          .getShapePageTransform(selected)
                                          .applyToPoint(bounds.point),
                                    },
                                 )
                              }
                           }}
                        />
                     </label>
                  ))}
               <button type='button' onClick={() => editor.deleteShapes([selected.id])}>
                  刪除選取物件
               </button>
            </fieldset>
         )}
         <ul aria-label='畫布連線'>
            {connections.map(({ arrow, start, end, points }) => (
               <li key={arrow.id}>
                  <button
                     type='button'
                     onClick={() => editor.select(arrow.id)}
                     aria-label={`選取連線 ${renderPlaintextFromRichText(editor, arrow.props.richText)}`}
                  >
                     {renderPlaintextFromRichText(editor, arrow.props.richText)}：{start} → {end}
                  </button>
                  <output
                     aria-label={`連線端點 ${renderPlaintextFromRichText(editor, arrow.props.richText)}`}
                  >
                     {points}
                  </output>
               </li>
            ))}
         </ul>
         <ul aria-label='畫布文字'>
            {shapes
               .filter((shape) => shape.type === 'text')
               .map((shape) => (
                  <li key={shape.id}>
                     <button
                        type='button'
                        onClick={() => editor.select(shape.id)}
                        aria-label={`選取文字 ${renderPlaintextFromRichText(editor, shape.props.richText)}`}
                     >
                        {renderPlaintextFromRichText(editor, shape.props.richText)} (x:
                        {Math.round(shape.x)}, y:{Math.round(shape.y)})
                     </button>
                  </li>
               ))}
         </ul>
      </>
   )
}
