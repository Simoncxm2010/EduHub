<script setup>
import { ref } from 'vue';
import { showToast } from 'vant';
import api, { toastError } from '../api';

/**
 * 「智能识别」输入框：把一段口语描述（或聊天截图）转成可上课时段。
 *
 * 只负责识别与展示，结果通过 recognized 事件交给宿主填进草稿——
 * 落库一律由宿主自己的保存流程完成，避免模型认错就直接写进库。
 * 老师端（代填学生）与学生端（填自己）共用这一个组件。
 */
defineProps({
  placeholder: {
    type: String,
    default: '把原话贴进来，例如：周二、周四晚上6点半到9点有空，周六上午9点到11点也行',
  },
});

const emit = defineEmits(['recognized']);

const text = ref('');
const image = ref('');
const busy = ref(false);
const reply = ref(null);
const fileInput = ref(null);

/** 清空输入（宿主每次打开编辑器时调用） */
function reset() {
  text.value = '';
  image.value = '';
  reply.value = null;
  if (fileInput.value) fileInput.value.value = '';
}
defineExpose({ reset });

function pickImage(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) return showToast('图片请控制在 4MB 以内');
  const reader = new FileReader();
  reader.onload = () => { image.value = String(reader.result); };
  reader.readAsDataURL(file);
}

async function run() {
  if (!text.value.trim() && !image.value) return showToast('先粘贴一段描述，或选一张聊天截图');
  busy.value = true;
  try {
    const d = await api.post('/availability/recognize', { text: text.value, image: image.value });
    reply.value = d;
    if (d.windows.length) {
      emit('recognized', d.windows);
      showToast({ type: 'success', message: `识别到 ${d.windows.length} 个时段，已填入` });
    } else {
      showToast('没能识别出可用时段，试试写得更具体些');
    }
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="ai-box">
    <div class="ai-box-head">
      <span><van-icon name="bulb-o" /> 智能识别</span>
      <van-tag :type="reply?.llm?.configured ? 'success' : 'default'" plain>
        {{ reply?.llm?.configured ? `大模型 · ${reply.llm.model}` : '内置规则解析' }}
      </van-tag>
    </div>

    <textarea
      v-model="text"
      class="ai-input"
      rows="3"
      :placeholder="placeholder"
    />

    <div class="ai-actions">
      <label class="ai-file">
        选聊天截图
        <input
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style="display: none"
          @change="pickImage"
        />
      </label>
      <span v-if="image" class="ai-picked">已选图片</span>
      <div style="flex: 1" />
      <van-button size="small" round type="primary" :loading="busy" @click="run">识别并填入</van-button>
    </div>

    <div v-if="reply?.warnings?.length" class="ai-note warn">{{ reply.warnings.join('；') }}</div>
    <div v-else-if="reply" class="ai-note">
      识别来源：{{ reply.provider === 'llm' ? '大模型' : reply.provider === 'llm+rule' ? '大模型（含规则兜底）' : '内置规则' }}
    </div>
    <div v-if="reply && !reply.llm.configured" class="ai-hint">
      未配置大模型接口（EDUHUB_LLM_API_KEY），当前用内置规则解析文字；图片需要配置接口后才能识别。
    </div>
  </div>
</template>

<style scoped>
.ai-box { margin-top: 14px; padding: 12px; border: 1px solid #e8ecf6; border-radius: 10px; background: #fafbff; }
.ai-box-head { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; margin-bottom: 8px; }
.ai-input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 11px;
  border: 1px solid #d9dfec;
  border-radius: 8px;
  font-family: inherit;
  font-size: 13.5px;
  line-height: 1.6;
  resize: vertical;
  background: #fff;
  color: inherit;
}
.ai-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.ai-file {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border: 1px solid #d9dfec;
  border-radius: 999px;
  background: #fff;
  font-size: 12.5px;
  color: #4a5470;
  cursor: pointer;
  user-select: none;
}
.ai-picked { font-size: 12px; color: #4a5470; }
.ai-note { font-size: 12.5px; padding: 7px 10px; border-radius: 8px; background: #eef2ff; color: #4a5470; margin-top: 8px; }
.ai-note.warn { background: #fff7e8; color: #b26a00; }
.ai-hint { font-size: 12px; color: #98a1b5; margin-top: 8px; line-height: 1.6; }

html.dark .ai-box { background: #171a24; border-color: #262b3a; }
html.dark .ai-input { background: #12141c; border-color: #2c3243; }
html.dark .ai-file { background: #1d2130; border-color: #2c3243; color: #b6bdcc; }
html.dark .ai-note { background: #1b2030; color: #b6bdcc; }
html.dark .ai-note.warn { background: #3a2a12; color: #ffb35c; }
</style>
