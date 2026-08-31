import { open } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "./store";
import { TagEditor } from "./TagEditor";

/** Mounts the tag editor whenever the store says a selection is being edited. */
export function TagEditorHost() {
  const tracks = useEditorStore((s) => s.tracks);
  const progress = useEditorStore((s) => s.progress);
  const save = useEditorStore((s) => s.save);
  const close = useEditorStore((s) => s.close);

  if (tracks === null) {
    return null;
  }
  return (
    <TagEditor
      tracks={tracks}
      progress={progress}
      onSave={(edit) => void save(edit)}
      onCancel={close}
      onPickCover={async () => {
        const picked = await open({
          multiple: false,
          filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png"] }],
        });
        return typeof picked === "string" ? picked : null;
      }}
    />
  );
}
