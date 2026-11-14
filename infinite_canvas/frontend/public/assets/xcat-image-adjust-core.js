/* ==================================================================
   xcat-image-adjust-core.js — 图像基本调整算法内核（2026-11-13）
   ------------------------------------------------------------------
   逐行移植自 E:/Toonflow/packages/nodeShared/src/imageAdjust.ts，
   后者又是从 @xdadda/mini-gl 的 filterAdjustments /
   filterHighlightsShadows 两枚 GLSL 着色器（MIT）搬来的。魔数
   （saturation 的 0.213/0.715/0.072、vignette 的 inner .20 / outer 1.1 /
   curvature .65、highlights 的 -0.76 / -0.8）一律照抄，不自行校准。

   像素在 [0,1] 线性光空间计算：入口 sRGB 解码、出口编码回去，中间必须
   用 Float32Array 中转 —— 直接拿 8bit ImageData 换算会把暗部量化吃掉，
   与 GPU 结果能差 20~40 灰阶；Float32 后平均偏差 1 灰阶以内。

   纯 Canvas 2D，不依赖 WebGL / Vue / 任何构建产物。
   ================================================================== */
(function () {
  'use strict';
  if (window.__xcatImageAdjustCore) return;

  var ADJUST_FIELDS = [
    { key: 'brightness', label: '亮度', min: -1, max: 1 },
    { key: 'exposure', label: '曝光', min: -1, max: 1 },
    { key: 'contrast', label: '对比度', min: -1, max: 1 },
    { key: 'highlights', label: '高光', min: -1, max: 1 },
    { key: 'shadows', label: '阴影', min: -1, max: 1 },
    { key: 'saturation', label: '饱和度', min: -1, max: 1 },
    { key: 'vibrance', label: '自然饱和度', min: -1, max: 1 },
    { key: 'temperature', label: '暖色', min: -1, max: 1 },
    { key: 'tint', label: '淡色', min: -1, max: 1 },
    { key: 'clarity', label: '清晰度', min: -1, max: 1 },
    { key: 'vignette', label: '晕影', min: 0, max: 1 }
  ];

  function defaultParams () {
    return {
      brightness: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0,
      saturation: 0, vibrance: 0, temperature: 0, tint: 0, clarity: 0, vignette: 0
    };
  }

  function isNoop (params) {
    return ADJUST_FIELDS.every(function (field) { return params[field.key] === 0; });
  }

  function clamp (value, low, high) {
    return value < low ? low : (value > high ? high : value);
  }
  function clamp01 (value) {
    return value < 0 ? 0 : (value > 1 ? 1 : value);
  }
  function smoothstep (edge0, edge1, x) {
    var t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
  }
  function srgbToLinear (value) {
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb (value) {
    return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  }

  var IDENTITY = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

  function multiplyMatrix (left, right) {
    var out = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (var row = 0; row < 4; row += 1) {
      for (var column = 0; column < 4; column += 1) {
        var sum = 0;
        for (var k = 0; k < 4; k += 1) sum += left[row][k] * right[k][column];
        out[row][column] = sum;
      }
    }
    return out;
  }

  /* 合并顺序与着色器完全一致：亮度 → 对比度 → 饱和度 → 曝光 → 暖色 → 淡色 */
  function buildColorMatrix (params) {
    var brightness = params.brightness / 4;
    var contrast = (params.contrast + 1) / 2 + 0.5;
    var saturation = params.saturation + 1;
    var exposure = ((params.exposure > 0 ? params.exposure * 3 : params.exposure * 1.5) + 1) / 2 + 0.5;
    var x = params.temperature * 2;
    var tint = params.tint * 2;

    var brightnessMatrix = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    var brightnessOffset = [brightness, brightness, brightness, 0];
    var contrastMatrix = [[contrast, 0, 0, 0], [0, contrast, 0, 0], [0, 0, contrast, 0], [0, 0, 0, 1]];
    var contrastOffset = [0.5 * (1 - contrast), 0.5 * (1 - contrast), 0.5 * (1 - contrast), 0];
    var saturationMatrix = [
      [0.213 + 0.787 * saturation, 0.715 - 0.715 * saturation, 0.072 - 0.072 * saturation, 0],
      [0.213 - 0.213 * saturation, 0.715 + 0.285 * saturation, 0.072 - 0.072 * saturation, 0],
      [0.213 - 0.213 * saturation, 0.715 - 0.715 * saturation, 0.072 + 0.928 * saturation, 0],
      [0, 0, 0, 1]
    ];
    var exposureMatrix = [[exposure, 0, 0, 0], [0, exposure, 0, 0], [0, 0, exposure, 0], [0, 0, 0, 1]];
    var temperatureMatrix = x > 0
      ? [[1 + 0.1 * x, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1 - 0.1 * x, 0], [0, 0, 0, 1]]
      : [[1 + 0.15 * x, 0, 0, 0], [0, 1 + 0.05 * x, 0, 0], [0, 0, 1 - 0.15 * x, 0], [0, 0, 0, 1]];
    var tintMatrix = [[1, 0, 0, 0], [0, 1 + 0.1 * tint, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

    var matrix = IDENTITY;
    var offset = [0, 0, 0, 0];
    var chain = [
      { matrix: brightnessMatrix, offset: brightnessOffset },
      { matrix: contrastMatrix, offset: contrastOffset },
      { matrix: saturationMatrix },
      { matrix: exposureMatrix },
      { matrix: temperatureMatrix },
      { matrix: tintMatrix }
    ];
    for (var i = 0; i < chain.length; i += 1) {
      matrix = multiplyMatrix(matrix, chain[i].matrix);
      if (chain[i].offset) {
        for (var j = 0; j < 4; j += 1) offset[j] += chain[i].offset[j];
      }
    }
    return { matrix: matrix, offset: offset };
  }

  /* 越界坐标夹回图内（等价 GPU clamp-to-edge），避免卷积出黑边 */
  function pick (source, width, height, x, y, channel) {
    var cx = x < 0 ? 0 : (x >= width ? width - 1 : x);
    var cy = y < 0 ? 0 : (y >= height ? height - 1 : y);
    return source[(cy * width + cx) * 3 + channel];
  }

  function applyClarity (buffer, width, height, clarity) {
    var f = clarity;
    var kernel = f >= 0
      ? [0, -f, 0, -f, 1 + 4 * f, -f, 0, -f, 0]
      : [-f, -2 * f, -f, -2 * f, 1 - 3 * f, -2 * f, -f, -2 * f, -f];
    var weight = kernel.reduce(function (sum, value) { return sum + value; }, 0);
    if (weight <= 0) weight = 1;
    var snapshot = Float32Array.from(buffer);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        var target = (y * width + x) * 3;
        for (var channel = 0; channel < 3; channel += 1) {
          var sum = 0;
          for (var ky = -1; ky <= 1; ky += 1) {
            for (var kx = -1; kx <= 1; kx += 1) {
              sum += pick(snapshot, width, height, x + kx, y + ky, channel) * kernel[(ky + 1) * 3 + (kx + 1)];
            }
          }
          buffer[target + channel] = clamp01(sum / weight);
        }
      }
    }
  }

  function applyHighlightsShadows (buffer, highlights, shadows) {
    var uHighlights = highlights + 1;
    var uShadows = shadows / 2 + 1;
    var whiteTarget = clamp(uHighlights, 0, 2) - 1;
    var blackTarget = 1 - clamp(uShadows, 0, 1);
    var shadowPower = 1 / uShadows;
    var highlightPower1 = 1 / (2 - uHighlights);
    var highlightPower2 = 2 / (2 - uHighlights);
    for (var index = 0; index < buffer.length; index += 3) {
      var r = buffer[index];
      var g = buffer[index + 1];
      var b = buffer[index + 2];
      var luminance = 0.2125 * r + 0.7154 * g + 0.0721 * b;
      if (luminance <= 0) continue;
      var shadow = clamp((Math.pow(luminance, shadowPower) + -0.76 * Math.pow(luminance, 2 / uShadows)) - luminance, 0, 1);
      var highlight = clamp((1 - (Math.pow(1 - luminance, highlightPower1) + -0.8 * Math.pow(1 - luminance, highlightPower2))) - luminance, -1, 0);
      var scale = (luminance + shadow + highlight) / luminance;
      var contrasted = (luminance - 0.5) * 1.5 + 0.5;
      var whiteInterp = contrasted * contrasted * contrasted;
      var inverseContrasted = 1 - contrasted;
      var blackInterp = inverseContrasted * inverseContrasted * inverseContrasted;
      var whiteBlend = whiteInterp * whiteTarget;
      var blackBlend = blackInterp * blackTarget;
      buffer[index] = (r * scale + (1 - r * scale) * whiteBlend) * (1 - blackBlend);
      buffer[index + 1] = (g * scale + (1 - g * scale) * whiteBlend) * (1 - blackBlend);
      buffer[index + 2] = (b * scale + (1 - b * scale) * whiteBlend) * (1 - blackBlend);
    }
  }

  /* 就地处理一张 ImageData。顺序照着色器 main()：
     清晰度 → gamma → 自然饱和度 → 颜色矩阵 → 晕影；
     高光 / 阴影是更早的独立一趟；gamma 恒 1，省略。 */
  function applyImageAdjust (image, params) {
    var width = image.width, height = image.height, data = image.data;
    if (isNoop(params)) return image;

    var count = width * height;
    var buffer = new Float32Array(count * 3);
    for (var pixel = 0, source = 0, dest = 0; pixel < count; pixel += 1, source += 4, dest += 3) {
      buffer[dest] = srgbToLinear(data[source] / 255);
      buffer[dest + 1] = srgbToLinear(data[source + 1] / 255);
      buffer[dest + 2] = srgbToLinear(data[source + 2] / 255);
    }

    if (params.highlights !== 0 || params.shadows !== 0) applyHighlightsShadows(buffer, params.highlights, params.shadows);
    if (params.clarity !== 0) applyClarity(buffer, width, height, params.clarity);

    var built = buildColorMatrix(params);
    var matrix = built.matrix, offset = built.offset;
    var vibrance = params.vibrance;
    var vignette = params.vignette;
    var hasVignette = vignette !== 0;
    var m00 = matrix[0][0], m01 = matrix[0][1], m02 = matrix[0][2];
    var m10 = matrix[1][0], m11 = matrix[1][1], m12 = matrix[1][2];
    var m20 = matrix[2][0], m21 = matrix[2][1], m22 = matrix[2][2];
    var o0 = offset[0], o1 = offset[1], o2 = offset[2];

    for (var y = 0; y < height; y += 1) {
      var ny = (y + 0.5) * 2 / height - 1;
      for (var x = 0; x < width; x += 1) {
        var target = (y * width + x) * 3;
        var r = buffer[target], g = buffer[target + 1], b = buffer[target + 2];

        if (vibrance !== 0) {
          var max = r > g ? (r > b ? r : b) : (g > b ? g : b);
          var average = (r + g + b) / 3;
          var amount = Math.abs(max - average) * 2 * -vibrance;
          if (r !== max) r += (max - r) * amount;
          if (g !== max) g += (max - g) * amount;
          if (b !== max) b += (max - b) * amount;
        }

        /* 三行必须都用变换前的 r/g/b，不能边算边覆盖 */
        var nr = clamp01(m00 * r + m01 * g + m02 * b + o0);
        var ng = clamp01(m10 * r + m11 * g + m12 * b + o1);
        var nb = clamp01(m20 * r + m21 * g + m22 * b + o2);
        r = nr; g = ng; b = nb;

        if (hasVignette) {
          var nx = (x + 0.5) * 2 / width - 1;
          var curveX = Math.pow(Math.abs(nx), 1 / 0.65);
          var curveY = Math.pow(Math.abs(ny), 1 / 0.65);
          var edge = Math.pow(Math.sqrt(curveX * curveX + curveY * curveY), 0.65);
          var factor = 1 - vignette * smoothstep(0.20, 1.1, edge);
          r *= factor; g *= factor; b *= factor;
        }

        buffer[target] = r;
        buffer[target + 1] = g;
        buffer[target + 2] = b;
      }
    }

    for (var p = 0, s = 0, t = 0; p < count; p += 1, s += 3, t += 4) {
      data[t] = linearToSrgb(clamp01(buffer[s])) * 255;
      data[t + 1] = linearToSrgb(clamp01(buffer[s + 1])) * 255;
      data[t + 2] = linearToSrgb(clamp01(buffer[s + 2])) * 255;
    }
    return image;
  }

  window.__xcatImageAdjustCore = {
    ADJUST_FIELDS: ADJUST_FIELDS,
    defaultParams: defaultParams,
    isNoop: isNoop,
    applyImageAdjust: applyImageAdjust
  };
})();
