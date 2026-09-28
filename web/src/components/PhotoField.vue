<script setup>
import { ref } from 'vue';
import { showImagePreview, showToast } from 'vant';
import { pickImage } from '../utils/image';

/**
 * 拍照/选图字段：手机端唤起相机，桌面端选文件；
 * 选完在本地压缩再上传，v-model 绑定服务端返回的图片地址。
 */
const props = defineProps({
  modelValue: { type: String, default: '' },
  kind: { type: String, default: 'photo' },
  maxSize: { type: Number, default: 1280 },
  buttonText: { type: String, default: '拍照 / 选图' },
  emptyText: { type: String, default: '还未拍摄' },
  height: { type: Number, default: 150 },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const input = ref(null);
const busy = ref(false);

async function onPick(e) {
  const file = e.target.files?.[0];
  e.target.value = ''; // 允许重复选同一张
  if (!file) return;
  busy.value = true;
  try {
    const url = await pickImage(file, { kind: props.kind, maxSize: props.maxSize });
    emit('update:modelValue', url);
  } catch (err) {
    showToast(err?.message || '上传失败，请重试');
  } finally {
    busy.value = false;
  }
}

function preview() {
  if (props.modelValue) showImagePreview([props.modelValue]);
}
</script>

<template>
  <div class="photo-field">
    <div v-if="modelValue" class="photo-preview" :style="{ height: `${height}px` }" @click="preview">
      <img :src="modelValue" alt="已上传图片" />
      <div v-if="!disabled" class="photo-actions">
        <van-button size="mini" round plain icon="photograph" @click.stop="input.click()">重拍</van-button>
        <van-button size="mini" round plain type="danger" icon="delete-o" @click.stop="emit('update:modelValue', '')">删除</van-button>
      </div>
      <div v-else class="photo-actions">
        <van-tag round type="success" size="medium">已上传</van-tag>
      </div>
    </div>
    <button v-else type="button" class="photo-empty" :style="{ height: `${height}px` }" :disabled="busy || disabled" @click="input.click">
      <van-loading v-if="busy" size="20" />
      <template v-else>
        <van-icon name="photograph" size="26" />
        <span>{{ buttonText }}</span>
      </template>
    </button>
    <div class="muted" style="margin-top: 6px">
      {{ modelValue ? '点击图片可放大查看' : emptyText }}
    </div>
    <input ref="input" type="file" accept="image/*" capture="environment" hidden @change="onPick" />
  </div>
</template>
