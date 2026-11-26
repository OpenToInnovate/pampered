/**
 * SVG → ImageBitmap, for MapLibre `addImage`.
 *
 * MapLibre wants a decoded image, not markup, so every icon we draw as SVG has
 * to cross this bridge once. It lives on its own so the venue icons and the
 * tube roundels can share it without the controller and the tube layer
 * importing each other.
 */
export async function svgToImage(svg: string, size: number): Promise<ImageBitmap> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image(size, size);
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("icon decode failed"));
      img.src = url;
    });
    return await createImageBitmap(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}
