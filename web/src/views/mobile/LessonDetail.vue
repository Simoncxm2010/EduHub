<script setup>
import { computed, nextTick, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showImagePreview, showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import { isDesktop } from '../../composables/layout';
import { ATTEND_STATUS, cnDate, endTime, fmtDate, LESSON_STATUS } from '../../utils';
import { uploadImage } from '../../utils/image';
import SignaturePad from '../../components/SignaturePad.vue';
import PhotoField from '../../components/PhotoField.vue';

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

/** student_id -> 签到状态 / 签名地址 */
const attendMap = reactive({});
const signMap = reactive({});

async function load() {
  loading.value = true;
  try {
    const d = await api.get(`/lessons/${lessonId}`);
    detail.value = d;
    applyAttendance(d.attendance);
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

function applyAttendance(list) {
  for (const s of detail.value.students) {
    attendMap[s.id] = undefined;
    signMap[s.id] = undefined;
  }
  for (const a of list || []) {
    attendMap[a.student_id] = a.status;
    if (a.signature) signMap[a.student_id] = a.signature;
  }
}

const statusCfg = computed(() => LESSON_STATUS[detail.value?.lesson.status || 'scheduled']);
const checkedCount = computed(() => Object.values(attendMap).filter((s) => s === 'present' || s === 'late').length);
const signedCount = computed(() => Object.values(signMap).filter(Boolean).length);
const myStudent = computed(() => {
  if (!auth.user || auth.canTeach || !detail.value) return null;
  return detail.value.students.find((s) => s.user_id === auth.user.id) || null;
});
const myAttendance = computed(() => (myStudent.value ? attendMap[myStudent.value.id] : undefined));
const mySignature = computed(() => (myStudent.value ? signMap[myStudent.value.id] : undefined));

/* ---------------- 教师：课堂留痕（课堂照片 + 教师签名） ---------------- */
const savingTrace = ref(false);

async function patchCheckin(patch) {
  savingTrace.value = true;
  try {
    const d = await api.put(`/lessons/${lessonId}/checkin`, patch);
    detail.value.lesson = d.lesson;
  } catch (e) {
    toastError(e);
  } finally {
    savingTrace.value = false;
  }
}

function onPhotoChange(url) {
  patchCheckin({ checkin_photo: url || null });
}

/* ---------------- 签名弹窗：教师签名 / 逐个学生签名 ---------------- */
const sign = reactive({ show: false, target: null, name: '' });
const signPad = ref(null);
const savingSign = ref(false);

function openSign(target, name = '') {
  sign.target = target;
  sign.name = name;
  sign.show = true;
  nextTick(() => signPad.value?.clear());
}

async function confirmSign() {
  const png = signPad.value?.exportPNG?.();
  if (!png) return showToast('请先手写签名');
  savingSign.value = true;
  try {
    const url = await uploadImage(png, 'signature');
    if (sign.target === 'teacher') {
      await patchCheckin({ teacher_signature: url });
      showToast({ type: 'success', message: '教师签名已保存' });
    } else {
      signMap[sign.target] = url;
      if (!attendMap[sign.target]) attendMap[sign.target] = 'present';
      await pushAttendance(true);
      showToast({ type: 'success', message: `${sign.name} 的签名已保存` });
    }
    sign.show = false;
  } catch (e) {
    toastError(e);
  } finally {
    savingSign.value = false;
  }
}

function clearSignature(sid) {
  signMap[sid] = undefined;
  pushAttendance(true);
}

/* ---------------- 教师：签到状态 ---------------- */
function markAllPresent() {
  for (const s of detail.value.students) attendMap[s.id] = 'present';
}

async function pushAttendance(silent = false) {
  const items = [];
  for (const s of detail.value.students) {
    const status = attendMap[s.id] || (signMap[s.id] ? 'present' : null);
    if (!status) continue;
    items.push({ student_id: s.id, status, signature: signMap[s.id] || null });
  }
  if (!items.length) {
    if (!silent) showToast('请先为学生选择签到状态');
    return;
  }
  savingAttend.value = true;
  try {
    const d = await api.put(`/lessons/${lessonId}/attendance`, { items });
    applyAttendance(d.attendance);
    if (!silent) showToast({ type: 'success', message: '签到已保存' });
  } catch (e) {
    toastError(e);
  } finally {
    savingAttend.value = false;
  }
}

/* ---------------- 学生：自助拍照 + 签名签到 ---------------- */
const self = reactive({ show: false, status: 'present', photo: '', saving: false });
const selfPad = ref(null);

function openSelf() {
  self.status = 'present';
  self.photo = '';
  self.show = true;
  nextTick(() => selfPad.value?.clear());
}

async function submitSelf() {
  const png = selfPad.value?.exportPNG?.();
  if (self.status !== 'leave' && !png) return showToast('请先手写签名');
  self.saving = true;
  try {
    const signature = png ? await uploadImage(png, 'signature') : null;
    await api.put(`/lessons/${lessonId}/attendance/me`, {
      status: self.status,
      signature,
      photo: self.photo || null,
    });
    showToast({ type: 'success', message: '签到完成' });
    self.show = false;
    await load();
  } catch (e) {
    toastError(e);
  } finally {
    self.saving = false;
  }
}

/* ---------------- 学生：请假申请 ---------------- */
const leave = reactive({ show: false, reason: '', saving: false });
const lessonCanceled = computed(() => detail.value?.lesson.status === 'canceled');

function openLeave() {
  leave.reason = '';
  leave.show = true;
}

async function submitLeave() {
  leave.saving = true;
  try {
    await api.post('/requests', { kind: 'leave', lesson_id: lessonId, reason: leave.reason });
    showToast({ type: 'success', message: '请假申请已提交，等待老师处理' });
    leave.show = false;
  } catch (e) {
    toastError(e);
  } finally {
    leave.saving = false;
  }
}

/* ---------------- 课堂记录 ---------------- */
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

/* ---------------- 课时状态 ---------------- */
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

/* 复制本节课到另一天（不带走签到与留痕） */
const showDupCal = ref(false);
const duplicating = ref(false);

async function duplicateTo(date) {
  showDupCal.value = false;
  duplicating.value = true;
  try {
    const d = await api.post(`/lessons/${lessonId}/duplicate`, { date: fmtDate(date) });
    showToast({ type: 'success', message: `已复制到 ${d.lesson.date}` });
    router.push(`/lessons/${d.lesson.id}`);
  } catch (e) {
    toastError(e);
  } finally {
    duplicating.value = false;
  }
}

function preview(url) {
  if (url) showImagePreview([url]);
}
</script>

<template>
  <div class="page page-plain">
    <van-nav-bar title="课时详情" left-arrow @click-left="router.back()" />

    <van-loading v-if="loading" style="margin: 30px auto" vertical>加载中…</van-loading>

    <template v-else-if="detail">
      <!-- 课程信息（两端通栏） -->
      <div class="card lesson-info" :style="{ borderTop: `3px solid ${detail.lesson.class_color}` }">
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
          <span v-if="detail.lesson.checkin_at"><van-icon name="certificate" /> 留痕于 {{ detail.lesson.checkin_at.slice(0, 16) }}</span>
        </div>
        <div v-if="detail.lesson.topic" class="lesson-topic">{{ detail.lesson.topic }}</div>

        <div v-if="auth.canTeach" class="lesson-tools">
          <van-button
            v-if="detail.lesson.status !== 'done'"
            size="small" round type="success" plain icon="passed"
            @click="setStatus('done')"
          >完成上课</van-button>
          <van-button v-else size="small" round plain icon="revoke" @click="setStatus('scheduled')">恢复待上课</van-button>
          <van-button
            v-if="detail.lesson.status !== 'canceled'"
            size="small" round plain type="warning" icon="close"
            @click="setStatus('canceled')"
          >取消课时</van-button>
          <van-button v-else size="small" round plain icon="revoke" @click="setStatus('scheduled')">恢复排课</van-button>
          <van-button size="small" round plain icon="plus" @click="showDupCal = true">复制到其他日期</van-button>
          <van-button size="small" round plain type="danger" icon="delete-o" @click="removeLesson">删除</van-button>
        </div>
      </div>

      <div class="lesson-detail">
        <!-- 主栏：留痕 + 课堂记录 -->
        <div class="col col-main">
          <template v-if="auth.canTeach">
            <div class="section-head">
              <span>签到留痕</span>
              <span v-if="savingTrace" class="muted">保存中…</span>
              <span v-else class="muted">照片与签名会随课时保存</span>
            </div>
            <div class="card" style="display: flex; flex-direction: column; gap: 16px">
              <PhotoField
                :model-value="detail.lesson.checkin_photo || ''"
                kind="photo"
                :max-size="1280"
                button-text="拍课堂照片"
                empty-text="还没拍课堂照片，点击上方按钮拍摄"
                :height="170"
                @update:model-value="onPhotoChange"
              />
              <div>
                <div class="muted" style="margin-bottom: 8px">教师签名（确认本节课已按计划完成）</div>
                <div v-if="detail.lesson.teacher_signature" class="trace-sign">
                  <img :src="detail.lesson.teacher_signature" alt="教师签名" @click="preview(detail.lesson.teacher_signature)" />
                  <van-button size="mini" round plain icon="edit" @click="openSign('teacher')">重签</van-button>
                  <van-button size="mini" round plain type="danger" icon="delete-o" @click="patchCheckin({ teacher_signature: null })">清除</van-button>
                </div>
                <van-button v-else round block plain icon="edit" @click="openSign('teacher')">手写教师签名</van-button>
              </div>
            </div>
          </template>

          <template v-else>
            <div v-if="detail.lesson.checkin_photo || detail.lesson.teacher_signature">
              <div class="section-head"><span>课堂留痕</span></div>
              <div class="card" style="display: flex; flex-direction: column; gap: 14px">
                <div v-if="detail.lesson.checkin_photo">
                  <div class="muted" style="margin-bottom: 6px">课堂照片</div>
                  <img class="trace-photo" :src="detail.lesson.checkin_photo" alt="课堂照片" @click="preview(detail.lesson.checkin_photo)" />
                </div>
                <div v-if="detail.lesson.teacher_signature">
                  <div class="muted" style="margin-bottom: 6px">教师签名</div>
                  <img class="trace-photo" style="height: 90px" :src="detail.lesson.teacher_signature" alt="教师签名" @click="preview(detail.lesson.teacher_signature)" />
                </div>
              </div>
            </div>
          </template>

          <div class="section-head">
            <span>课堂记录</span>
            <span v-if="detail.record" class="muted">更新于 {{ detail.record.updated_at?.slice(0, 16) }}</span>
          </div>
          <div class="card">
            <template v-if="auth.canTeach">
              <van-field
                v-model="record.content" type="textarea" rows="4" autosize
                placeholder="本节课讲了什么？" @update:model-value="recordDirty = true"
              />
              <van-field
                v-model="record.homework" type="textarea" rows="2" autosize
                placeholder="布置的作业（选填）" @update:model-value="recordDirty = true"
              />
              <van-button round block type="primary" style="margin-top: 8px" :loading="savingRecord" @click="saveRecord">
                {{ detail.record ? '更新记录' : '保存记录' }}
              </van-button>
            </template>
            <template v-else>
              <div v-if="record.content" style="font-size: 14px; line-height: 1.75; white-space: pre-wrap">{{ record.content }}</div>
              <div v-if="record.homework" style="margin-top: 12px">
                <van-tag plain type="warning">作业</van-tag>
                <div style="font-size: 14px; line-height: 1.75; margin-top: 6px; white-space: pre-wrap">{{ record.homework }}</div>
              </div>
              <van-empty v-if="!record.content && !record.homework" image="search" description="老师还没有填写记录" style="padding: 10px 0" />
            </template>
          </div>
        </div>

        <!-- 签到栏 -->
        <div class="col col-attend">
          <template v-if="auth.canTeach">
            <div class="section-head">
              <span>签到</span>
              <span class="muted">已到 {{ checkedCount }}/{{ detail.students.length }} · 已签 {{ signedCount }}</span>
            </div>
            <div class="card">
              <div class="attend-tools">
                <van-tag plain type="success" @click="markAllPresent">全部到齐</van-tag>
                <span class="muted">点「签名」请学生本人手写确认</span>
              </div>
              <div v-for="s in detail.students" :key="s.id" class="attend-row">
                <div class="attend-name">
                  <span>{{ s.name }}</span>
                  <van-tag v-if="s.remark" plain>{{ s.remark }}</van-tag>
                </div>
                <div class="attend-actions">
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
                  <div style="display: flex; align-items: center; gap: 8px">
                    <img
                      v-if="signMap[s.id]"
                      class="sign-thumb"
                      :src="signMap[s.id]"
                      alt="学生签名"
                      @click="preview(signMap[s.id])"
                    />
                    <button
                      class="sign-btn"
                      :class="{ done: !!signMap[s.id] }"
                      @click="openSign(s.id, s.name)"
                    >
                      <van-icon :name="signMap[s.id] ? 'passed' : 'edit'" />
                      {{ signMap[s.id] ? '已签名' : '签名' }}
                    </button>
                    <van-icon
                      v-if="signMap[s.id]"
                      name="delete-o"
                      color="#c3c9d6"
                      size="16"
                      @click="clearSignature(s.id)"
                    />
                  </div>
                </div>
              </div>
              <van-empty v-if="!detail.students.length" image="search" description="班级还没有学生" style="padding: 16px 0" />
              <van-button
                v-if="detail.students.length"
                round block type="primary" style="margin-top: 12px" :loading="savingAttend"
                @click="pushAttendance(false)"
              >保存签到</van-button>
            </div>
          </template>

          <template v-else>
            <div class="section-head">
              <span>我的签到</span>
              <span class="muted">需要拍照 + 手写签名</span>
            </div>
            <div class="card">
              <template v-if="myStudent && myAttendance">
                <div class="self-done">
                  <van-icon name="passed" size="20" color="#07c160" />
                  <div style="flex: 1">
                    <div style="font-weight: 600">已签到 · {{ ATTEND_STATUS[myAttendance]?.text }}</div>
                    <div class="muted" style="margin-top: 4px">如需修改可重新签到</div>
                  </div>
                  <van-button size="small" round plain @click="openSelf">重新签到</van-button>
                </div>
                <div v-if="mySignature" style="margin-top: 12px">
                  <div class="muted" style="margin-bottom: 6px">我的签名</div>
                  <img class="trace-photo" style="height: 90px" :src="mySignature" alt="我的签名" @click="preview(mySignature)" />
                </div>
              </template>
              <template v-else-if="myStudent">
                <van-empty image="search" description="你还没有签到" style="padding: 14px 0" />
                <van-button round block type="primary" icon="photograph" @click="openSelf">拍照 + 签名签到</van-button>
              </template>
              <van-empty v-else image="search" description="你不在本节课的班级中" style="padding: 14px 0" />

              <div v-if="myStudent" style="margin-top: 12px">
                <van-button round block plain icon="todo-list-o" :disabled="lessonCanceled" @click="openLeave">
                  {{ lessonCanceled ? '本节课已取消，无需请假' : '这节课来不了？提交请假申请' }}
                </van-button>
              </div>
            </div>

            <div class="section-head">
              <span>本班签到</span>
              <span class="muted">已到 {{ checkedCount }}/{{ detail.students.length }}</span>
            </div>
            <div class="card card-tight">
              <div v-for="s in detail.students" :key="s.id" class="attend-row">
                <div class="attend-name">
                  <span>{{ s.name }}</span>
                  <van-tag v-if="s.user_id === auth.user?.id" plain type="primary">我</van-tag>
                </div>
                <div class="attend-actions">
                  <van-tag v-if="signMap[s.id] && s.user_id === auth.user?.id" plain type="success">已签名</van-tag>
                  <van-tag v-else-if="detail.attendance.find((a) => a.student_id === s.id)?.signed" plain type="success">已签</van-tag>
                  <span v-else class="muted">未签</span>
                  <van-tag
                    v-if="attendMap[s.id]"
                    :color="ATTEND_STATUS[attendMap[s.id]].color"
                  >{{ ATTEND_STATUS[attendMap[s.id]].text }}</van-tag>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>

    <!-- 签名弹窗（教师签名 / 学生签名） -->
    <van-popup
      v-model:show="sign.show"
      round
      class="eduhub-popup"
      :position="isDesktop ? 'center' : 'bottom'"
      style="padding: 18px 16px 22px"
    >
      <div class="form-title">{{ sign.target === 'teacher' ? '教师签名' : `${sign.name} 的签名` }}</div>
      <SignaturePad ref="signPad" :height="200" />
      <div style="margin-top: 16px">
        <van-button round block type="primary" :loading="savingSign" @click="confirmSign">确认签名</van-button>
      </div>
    </van-popup>

    <!-- 学生自助签到 -->
    <van-popup
      v-model:show="self.show"
      round
      class="eduhub-popup"
      :position="isDesktop ? 'center' : 'bottom'"
      style="padding: 18px 16px 22px; max-height: 88vh; overflow-y: auto"
    >
      <div class="form-title">拍照 + 签名签到</div>
      <div class="muted" style="margin-bottom: 6px">签到状态</div>
      <div class="seg" style="margin-bottom: 16px">
        <span
          v-for="key in ['present', 'late', 'leave']"
          :key="key"
          class="seg-item"
          :class="{ on: self.status === key }"
          :style="self.status === key ? { background: ATTEND_STATUS[key].color } : {}"
          @click="self.status = key"
        >{{ ATTEND_STATUS[key].text }}</span>
      </div>
      <div class="muted" style="margin-bottom: 6px">现场照片（选填，用于核实在场）</div>
      <PhotoField
        v-model="self.photo"
        kind="photo"
        :max-size="1024"
        button-text="拍照"
        empty-text="可选：拍一张现场照片"
        :height="130"
      />
      <div class="muted" style="margin: 16px 0 6px">
        手写签名{{ self.status === 'leave' ? '（请假可不签）' : '' }}
      </div>
      <SignaturePad ref="selfPad" :height="180" />
      <div style="margin-top: 16px">
        <van-button round block type="primary" :loading="self.saving" @click="submitSelf">提交签到</van-button>
      </div>
    </van-popup>

    <!-- 复制课时到其他日期 -->
    <van-calendar
      v-model:show="showDupCal"
      :min-date="new Date(2020, 0, 1)"
      :max-date="new Date(2032, 11, 31)"
      :title="`复制「${detail?.lesson.class_name || ''}」到哪一天？`"
      @confirm="duplicateTo"
    />
  </div>
</template>
