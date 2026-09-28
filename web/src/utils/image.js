import api from '../api';

/**
 * 客户端压缩：长边限制 + JPEG 质量。
 * 手机原图动辄几 MB，直传会让上传接口和存储都很难受，这里先压到几百 KB。
 */
export function compressImage(file, { maxSize = 1280, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || '')) {
      return reject(new Error('请选择图片文件'));
    }
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        reject(new Error('图片处理失败，请重试'));
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('图片格式不支持，请重新拍摄'));
    };
    img.src = objectUrl;
  });
}

/** 上传 data URL，返回服务端可访问的图片地址 */
export async function uploadImage(dataUrl, kind = 'photo') {
  const res = await api.post('/uploads', { data: dataUrl, kind });
  return res.url;
}

/** 选图 → 压缩 → 上传，一步到位 */
export async function pickImage(file, { kind = 'photo', maxSize = 1280 } = {}) {
  const dataUrl = await compressImage(file, { maxSize });
  return uploadImage(dataUrl, kind);
}
