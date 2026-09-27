<script setup>
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import api, { toastError } from '../api';
import { useAuthStore } from '../store';
import { ATTEND_STATUS, cnDate, endTime, LESSON_STATUS } from '../utils';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const lessonId = Number(route.params.id);

const detail = ref(null);
const loading = ref(true);
const record = reactive({ content: '', homework: '' });
const recordDirty = ref(false);
const savingRecord = ref(false);
const savingAttend = ref(false);

const attendMap = reactive({}); // student_id -> status | undefined

async function load() {
  loading.value = true;
  try {
    const d = await api.get(`/lessons/${lessonId}`);
    detail.value = d;
    for (const a of d.attendance) attendMap[a.student_id] = a.status;
    record.content = d.record?.content || '';
    record.homework = d.record?.homework || '';
    recordDirty.value = false;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}
load();

const statusCfg = computed(() => LESSON_STATUS[detail.value?.lesson.status || 'scheduled']);
const checkedCount = computed(() => Object.values(attendMap).filter((s) => s === 'present' || s === 'late').length);
const myStudent = computed(() =>
  auth.user && !auth.isTeacher ? detail.value?.students.find((s) => s.user_id === auth.user.id) : null
);

function markAllPresent() {
  for (const s of detail.value.students) attendMap[s.id] = 'present';
}

async function saveAttendance() {
  const items = Object.entries(attendMap)
    .filter(([, v]) => v)
    .map(([sid, status]) => ({ student_id: Number(sid), status }));
  if (!items.length) return showToast('请先为学生选择签到状态');
  savingAttend.value = true;
  try {
    const d = await api.put(`/lessons/${lessonId}/attendance`, { items });
    showToast({ type: 'success', message: '签到已保存' });
    const map = {};
    for (const a of d.attendance) map[a.student_id] = a.status;
    for (const s of detail.value.students) attendMap[s.id] = map[s.id] || undefined;
  } catch (e) {
    toastError(e);
  } finally {
    savingAttend.value = false;
  }
}

async function saveRecord() {
  savingRecord.value = true;
  try {
    const d = await api.put(`/lessons/${lessonId}/record`, { ...record });
    showToast({ type: 'success', message: '课堂记录已保存' });
    detail.value.record = d.record;
    recordDirty.value = false;
  } catch (e) {
    toastError(e);
  } finally {
    savingRecord.value = false;
  }
}

async function setStatus(status) {
  try {
    await api.put(`/lessons/${lessonId}`, { status });
    showToast('已更新');
    load();
  } catch (e) {
    toastError(e);
  }
}

async function removeLesson() {
  try {
    await showConfirmDialog({ title: '删除课时', message: '删除后签到与记录将一并删除，确定删除本节课吗？' });
  } catch {
    return;
  }
  try {
    await api.delete(`/lessons/${lessonId}`);
    showToast('已删除');
    router.replace('/schedule');
  } catch (e) {
    toastError(e);
  }
}

function markDirty() {
  recordDirty.value = true;
}
</script>

<template>
  <div class="page page-plain" style="padding-top: 0">
    <van-nav-bar title="课时详情" left-arrow @click-left="router.back()" />

    <van-loading v-if="loading" style="margin: 30px auto" vertical>加载中…</van-loading>
    <template v-else-if="detail">
      <div class="card" :style="{ borderTop: `3px solid ${detail.lesson.class_color}` }">
        <div class="lesson-top">
          <span class="lesson-dot" :style="{ background: detail.lesson.class_color }" />
          <span class="lesson-class" style="font-size: 17px">{{ detail.lesson.class_name }}</span>
          <van-tag :type="statusCfg.color">{{ statusCfg.text }}</van-tag>
        </div>
        <div class="lesson-time" style="margin-top: 10px; font-size: 15px">
          <van-icon name="clock-o" />
          {{ cnDate(detail.lesson.date) }} · {{ detail.lesson.start_time }} - {{ endTime(detail.lesson.start_time, detail.lesson.duration_min) }}
        </div>
        <div class="lesson-meta" style="margin-top: 8px">
          <span>授课老师：{{ detail.teacher?.name || '-' }}</span>
          <span v-if="detail.lesson.room"><van-icon name="location-o" /> {{ detail.lesson.room }}</span>
        </div>
        <div v-if="detail.lesson.topic" class="lesson-topic">{{ detail.lesson.topic }}</div>

        <div v-if="auth.isTeacher" style="display: flex; gap: 8px; margin-top: 12px">
          <van-button
            v-if="detail.lesson.status !== 'done'"
            size="small"
            round
            type="success"
            plain
            icon="passed"
            @click="setStatus('done')"
          >完成上课</van-button>
          <van-button v-else size="small" round plain icon="revoke" @click="setStatus('scheduled')">恢复待上课</van-button>
          <van-button
            v-if="detail.lesson.status !== 'canceled'"
            size="small"
            round
            plain
            type="warning"
            icon="close"
            @click="setStatus('canceled')"
          >取消课时</van-button>
          <van-button v-else size="small" round plain icon="revoke" @click="setStatus('scheduled')">恢复排课</van-button>
          <van-button size="small" round plain type="danger" icon="delete-o" @click="removeLesson">删除</van-button>
        </div>
      </div>

      <!-- 签到 -->
      <div class="section-head">
        <span>签到</span>
        <span class="muted">已到 {{ checkedCount }}/{{ detail.students.length }}</span>
      </div>
      <div class="card">
        <template v-if="auth.isTeacher">
          <div style="display: flex; justify-content: flex-end; margin-bottom: 6px">
            <van-tag plain type="success" @click="markAllPresent">全部到齐</van-tag>
          </div>
          <div v-for="s in detail.students" :key="s.id" class="attend-row">
            <div class="attend-name">
              {{ s.name }}
              <span v-if="s.remark" class="muted">{{ s.remark }}</span>
            </div>
            <div class="seg">
              <span
                v-for="(cfg, key) in ATTEND_STATUS"
                :key="key"
                class="seg-item"
                :class="{ on: attendMap[s.id] === key }"
                :style="attendMap[s.id] === key ? { background: cfg.color } : {}"
                @click="attendMap[s.id] = attendMap[s.id] === key ? undefined : key"
              >{{ cfg.text }}</span>
            </div>
          </div>
          <van-empty v-if="!detail.students.length" image="search" description="班级还没有学生" style="padding: 16px 0" />
          <van-button
            v-if="detail.students.length"
            round
            block
            type="primary"
            style="margin-top: 10px"
            :loading="savingAttend"
            @click="saveAttendance"
          >保存签到</van-button>
        </template>

        <template v-else>
          <div v-for="s in detail.students" :key="s.id" class="attend-row">
            <div class="attend-name">
              {{ s.name }}
              <van-tag v-if="s.user_id === auth.user?.id" plain type="primary" style="margin-left: 6px">我</van-tag>
            </div>
            <van-tag
              v-if="attendMap[s.id]"
              :color="ATTEND_STATUS[attendMap[s.id]].color"
            >{{ ATTEND_STATUS[attendMap[s.id]].text }}</van-tag>
            <span v-else class="muted">未签到</span>
          </div>
        </template>
      </div>

      <!-- 课堂记录 -->
      <div class="section-head">
        <span>课堂记录</span>
        <span v-if="detail.record" class="muted">更新于 {{ detail.record.updated_at?.slice(0, 16) }}</span>
      </div>
      <div class="card">
        <template v-if="auth.isTeacher">
          <van-field
            v-model="record.content"
            label=""
            type="textarea"
            rows="4"
            autosize
            placeholder="本节课讲了什么？"
            @update:model-value="markDirty"
          />
          <van-field
            v-model="record.homework"
            label=""
            type="textarea"
            rows="2"
            autosize
            placeholder="布置的作业（选填）"
            @update:model-value="markDirty"
          />
          <van-button round block type="primary" style="margin-top: 8px" :loading="savingRecord" @click="saveRecord">
            {{ detail.record ? '更新记录' : '保存记录' }}
          </van-button>
        </template>
        <template v-else>
          <div v-if="record.content" style="font-size: 14px; line-height: 1.7; white-space: pre-wrap">{{ record.content }}</div>
          <div v-if="record.homework" style="margin-top: 10px">
            <van-tag plain type="warning">作业</van-tag>
            <div style="font-size: 14px; line-height: 1.7; margin-top: 6px; white-space: pre-wrap">{{ record.homework }}</div>
          </div>
          <van-empty v-if="!record.content && !record.homework" image="search" description="老师还没有填写记录" style="padding: 10px 0" />
        </template>
      </div>
    </template>
  </div>
</template>
