'use client'

import { X } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'

export function ModalFrame({
   title,
   onClose,
   children,
   wide = false,
}: {
   title: string
   onClose: () => void
   children: ReactNode
   wide?: boolean
}) {
   const closeRef = useRef<HTMLButtonElement>(null)
   useEffect(() => {
      const previous = document.activeElement
      closeRef.current?.focus()
      const onKey = (event: KeyboardEvent) => {
         if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
         }
         if (event.key === 'Tab') {
            const items = closeRef.current
               ?.closest('[role="dialog"]')
               ?.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), input:not(:disabled), textarea, a[href], [tabindex="0"]',
               )
            if (!items?.length) return
            const first = items[0]
            const last = items[items.length - 1]
            if (event.shiftKey && document.activeElement === first) {
               event.preventDefault()
               last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
               event.preventDefault()
               first.focus()
            }
         }
      }
      window.addEventListener('keydown', onKey, true)
      return () => {
         window.removeEventListener('keydown', onKey, true)
         if (previous instanceof HTMLElement) previous.focus()
      }
   }, [onClose])
   return (
      <div
         className='modal-backdrop'
         onPointerDown={(event) => {
            if (event.target === event.currentTarget) onClose()
         }}
      >
         <section
            className={`modal ${wide ? 'modal-wide' : ''}`}
            role='dialog'
            aria-modal='true'
            aria-label={title}
         >
            <header className='panel-header'>
               <h2>{title}</h2>
               <button
                  type='button'
                  ref={closeRef}
                  className='icon-button'
                  aria-label='關閉對話框'
                  onClick={onClose}
               >
                  <X size={19} />
               </button>
            </header>
            {children}
         </section>
      </div>
   )
}
