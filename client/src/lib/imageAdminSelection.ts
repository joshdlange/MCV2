export function selectImageAdmin<T extends { id: number; username: string }>(
  editors: T[], selectedId: string | null,
): T | undefined {
  // An explicit choice must never fall back to a different editor.
  return selectedId !== null
    ? editors.find(editor => String(editor.id) === selectedId)
    : editors.find(editor => editor.username.toLowerCase() === "yours_sincerely2006");
}
