import {
   ArrowBindingUtil,
   type BindingOnShapeIsolateOptions,
   type Editor,
   type TLArrowBinding,
   type TLShapeId,
} from 'tldraw'

/** Preserve the originator's baked endpoint when a deletion is replayed by sync. */
export class SyncedArrowBindingUtil extends ArrowBindingUtil {
   private readonly remoteDeletes = new Set<TLShapeId>()

   constructor(editor: Editor) {
      super(editor)
      // Binding utilities are constructed before the editor's shape-deletion
      // callbacks. Capture the public change source before isolation runs.
      const stopDelete = editor.store.sideEffects.registerBeforeDeleteHandler(
         'shape',
         (shape, source) => {
            if (source === 'remote') this.remoteDeletes.add(shape.id)
         },
      )
      const stopOperation = editor.store.sideEffects.registerOperationCompleteHandler(() => {
         this.remoteDeletes.clear()
      })
      editor.on('dispose', () => {
         stopDelete()
         stopOperation()
      })
   }

   override onBeforeIsolateFromShape(options: BindingOnShapeIsolateOptions<TLArrowBinding>) {
      // A remote transaction already contains the deleting editor's endpoint.
      // Re-baking it against a speculative concurrent move changes the local
      // arrow without publishing that change, diverging from the room snapshot.
      if (this.remoteDeletes.has(options.removedShape.id)) return
      super.onBeforeIsolateFromShape(options)
   }
}

export const syncedBindingUtils = [SyncedArrowBindingUtil]
