// Saving and sharing a document file (a booking confirmation PDF or picture).

export function saveFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Can this device hand a file to its own share sheet (a phone, the Windows share panel)? */
export function canShareFiles() {
  try {
    const probe = new File(["x"], "x.pdf", { type: "application/pdf" });
    return !!(navigator.canShare && navigator.canShare({ files: [probe] }));
  } catch {
    return false;
  }
}

/** Hand the file to the device's share sheet. Resolves false if the person closed it. */
export async function shareFile(blob, filename, { title, text } = {}) {
  const file = new File([blob], filename, { type: blob.type });
  try {
    await navigator.share({ files: [file], title, text });
    return true;
  } catch (err) {
    if (err?.name === "AbortError") return false;
    throw err;
  }
}

/** A filename safe on Windows, phones and WhatsApp. */
export const safeFilename = (s) => String(s).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
