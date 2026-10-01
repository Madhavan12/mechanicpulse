const MAX_EDGE = 1600;
const QUALITY = 0.8;

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * iPhone Safari can't encode WebP: it silently returns a PNG, which is
 * bigger than the original photo. Fall back to JPEG when that happens.
 * Ported from apps/spike/index.html (see docs/spike-results.md).
 */
export function compressImage(file: File): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (webp) => {
          if (webp && webp.type === "image/webp") {
            resolve({ blob: webp, width, height });
            return;
          }
          canvas.toBlob(
            (jpeg) => (jpeg ? resolve({ blob: jpeg, width, height }) : reject(new Error("Could not compress that photo."))),
            "image/jpeg",
            QUALITY
          );
        },
        "image/webp",
        QUALITY
      );
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error("Could not read that photo."));
    img.src = URL.createObjectURL(file);
  });
}
