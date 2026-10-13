// Turn a document on screen (a booking confirmation) into a file a guest can be
// sent: a PDF or a picture, made from exactly what is shown, so it looks the same
// in WhatsApp as it does printed.
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const snapshot = (el) => html2canvas(el, {
  scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false,
  windowWidth: Math.max(el.scrollWidth, 720),
});

/** A4 PDF of the element; a long document runs onto more pages. */
export async function elementToPdf(el) {
  const canvas = await snapshot(el);
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 10;
  const w = 210 - margin * 2;
  const pageH = 297 - margin * 2;
  const pxPerPage = Math.floor((canvas.width * pageH) / w);
  for (let y = 0, page = 0; y < canvas.height; y += pxPerPage, page += 1) {
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = Math.min(pxPerPage, canvas.height - y);
    slice.getContext("2d").drawImage(canvas, 0, y, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
    if (page) pdf.addPage();
    pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, w, (slice.height * w) / canvas.width);
  }
  return pdf.output("blob");
}

/** PNG picture of the element. */
export async function elementToImage(el) {
  const canvas = await snapshot(el);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No image"))), "image/png"));
}

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
