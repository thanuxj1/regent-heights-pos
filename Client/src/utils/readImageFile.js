/**
 * Read a picked image and downscale it before turning it into a data URL.
 *
 * Photos go into TEXT columns as data: URLs, and a raw phone photo is 3–5 MB of
 * base64 — enough to blow past the server's 15 MB body limit. Downscaling keeps
 * them sharp at roughly 200–400 KB.
 */
export function readImageFile(file, { maxWidth = 1600, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith("image/")) {
      reject(new Error(`${file?.name || "That file"} is not an image`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error(`${file.name} is not a valid image`));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        // PNGs with transparency would go black as JPEG, so keep those as PNG.
        const asPng = file.type === "image/png";
        resolve(canvas.toDataURL(asPng ? "image/png" : "image/jpeg", quality));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}
