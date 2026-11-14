// 图像编辑共用的加载 / 导出工具

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = src;
  });
}

export function canvasToBlob(canvas, type = "image/png") {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("图片导出失败"))),
      type
    );
  });
}

// a.jpg -> a
export function baseName(name) {
  const value = String(name || "image");
  const at = value.lastIndexOf(".");
  return at > 0 ? value.slice(0, at) : value;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
