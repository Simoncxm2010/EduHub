<script setup>
import { computed, nextTick, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showImagePreview, showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import Modal from '../../ui/Modal.vue';
import SignaturePad from '../../components/SignaturePad.vue';
import PhotoField from '../../components/PhotoField.vue';
import { ATTEND_STATUS, cnDate, endTime, fmtDate, LESSON_STATUS, BADGE } from '../../utils';
import { uploadImage } from '../../utils/image';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const lessonId = Number(route.params.id);

const detail = ref(null);
const loading = ref(true);
const record = reactive({ content: '', homework: '' });
const savingRecord = ref(false);
const savingAttend = ref(false);
const savingTrace = ref(false);

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

/* 留痕 */
async function patchCheckin(patch) {
  savingTrace.value = true;
  try {
    const d = await api.put(`/lessons/${lessonId}/checkin`, patch);
    detail.value.lesson = d.lesson;
    showToast({ type: 'success', message: '留痕已保存' });
  } catch (e) {
    toastError(e);
  } finally {
    savingTrace.value = false;
  }
}

/* 签名弹窗 */
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

/* 签到 */
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

/* 学生自助签到 */
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
    await api.put(`/lessons/${lessonId}/attendance/me`, { status: self.status, signature, photo: self.photo || null });
    showToast({ type: 'success', message: '签到完成' });
    self.show = false;
    await load();
  } catch (e) {
    toastError(e);
  } finally {
    self.saving = false;
  }
}

/* 学生请假申请 */
const leave = reactive({ show: false, reason: '', saving: false });

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

/* 记录 / 状态 / 复制 / 删除 */
async function saveRecord() {
  savingRecord.value = true;
  try {
    const d = await api.put(`/lessons/${lessonId}/record`, { ...record });
    showToast({ type: 'success', message: '课堂记录已保存' });
    detail.value.record = d.record;
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

const showDup = ref(false);
const dupDate = ref(fmtDate(new Date()));

async function duplicate() {
  try {
    const d = await api.post(`/lessons/${lessonId}/duplicate`, { date: dupDate.value });
    showToast({ type: 'success', message: `已复制到 ${d.lesson.date}` });
    showDup.value = false;
    router.push(`/lessons/${d.lesson.id}`);
  } catch (e) {
    toastError(e);
  }
}

async function removeLesson() {
  try {
    await showConfirmDialog({ title: '删除课时', message: '删除后签到与记录一并删除，确定吗？', confirmButtonText: '删除' });
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

function preview(url) {
  if (url) showImagePreview([url]);
}
</script>

<template>
  <div class="d-page">
    <div v-if="loading" class="d-empty">加载中…</div>
    <template v-else-if="detail">
      <div class="d-head">
        <div>
          <h1>
            <span class="d-dot" :style="{ background: detail.lesson.class_color, width: '12px', height: '12px', marginRight: '10px' }" />
            {{ detail.lesson.class_name }}
          </h1>
          <div class="sub">
            {{ cnDate(detail.lesson.date) }} · {{ detail.lesson.start_time }} - {{ endTime(detail.lesson.start_time, detail.lesson.duration_min) }}
            · 授课老师 {{ detail.teacher?.name || '—' }}
            <template v-if="detail.lesson.room"> · {{ detail.lesson.room }}</template>
            <template v-if="detail.lesson.checkin_at"> · 留痕于 {{ detail.lesson.checkin_at.slice(0, 16) }}</template>
          </div>
        </div>
        <div class="d-head-actions">
          <span class="d-badge" :class="BADGE[statusCfg.color]">{{ statusCfg.text }}</span>
          <template v-if="auth.canTeach">
            <button v-if="detail.lesson.status !== 'done'" class="d-btn" @click="setStatus('done')">完成上课</button>
            <button v-else class="d-btn" @click="setStatus('scheduled')">恢复待上课</button>
            <button v-if="detail.lesson.status !== 'canceled'" class="d-btn" @click="setStatus('canceled')">取消课时</button>
            <button v-else class="d-btn" @click="setStatus('scheduled')">恢复排课</button>
            <button class="d-btn" @click="showDup = true">复制到其他日期</button>
            <button class="d-btn danger" @click="removeLesson">删除</button>
          </template>
        </div>
      </div>

      <div v-if="detail.lesson.topic" class="d-badge info" style="margin-bottom: 16px; padding: 8px 14px">
        本节主题：{{ detail.lesson.topic }}
      </div>

      <div class="d-split">
        <div class="d-col">
          <template v-if="auth.canTeach">
            <div class="d-card">
              <div class="d-card-title">
                <span>签到留痕</span>
                <span class="d-badge" :class="savingTrace ? 'warn' : 'mute'">{{ savingTrace ? '保存中…' : '照片与签名随课时保存' }}</span>
              </div>
              <PhotoField
                :model-value="detail.lesson.checkin_photo || ''"
                kind="photo"
                :max-size="1280"
                button-text="拍课堂照片"
                empty-text="还没拍课堂照片"
                :height="200"
                @update:model-value="(url) => patchCheckin({ checkin_photo: url || null })"
              />
              <div style="margin-top: 18px">
                <div style="font-size: 12.5px; color: #5a6684; margin-bottom: 8px">教师签名（确认本节课已按计划完成）</div>
                <div v-if="detail.lesson.teacher_signature" class="trace-sign">
                  <img :src="detail.lesson.teacher_signature" alt="教师签名" @click="preview(detail.lesson.teacher_signature)" />
                  <button class="d-btn sm" @click="openSign('teacher')">重签</button>
                  <button class="d-btn sm danger" @click="patchCheckin({ teacher_signature: null })">清除</button>
                </div>
                <button v-else class="d-btn block" @click="openSign('teacher')">手写教师签名</button>
              </div>
            </div>
          </template>

          <template v-else>
            <div v-if="detail.lesson.checkin_photo || detail.lesson.teacher_signature" class="d-card">
              <div class="d-card-title"><span>课堂留痕</span></div>
              <div v-if="detail.lesson.checkin_photo" style="margin-bottom: 16px">
                <div style="font-size: 12.5px; color: #5a6684; margin-bottom: 6px">课堂照片</div>
                <img class="trace-photo" :src="detail.lesson.checkin_photo" alt="课堂照片" @click="preview(detail.lesson.checkin_photo)" />
              </div>
              <div v-if="detail.lesson.teacher_signature">
                <div style="font-size: 12.5px; color: #5a6684; margin-bottom: 6px">教师签名</div>
                <img class="trace-photo" style="height: 100px; object-fit: contain" :src="detail.lesson.teacher_signature" alt="教师签名" @click="preview(detail.lesson.teacher_signature)" />
              </div>
            </div>
          </template>

          <div class="d-card">
            <div class="d-card-title">
              <span>课堂记录</span>
              <span v-if="detail.record" class="d-badge mute">更新于 {{ detail.record.updated_at?.slice(0, 16) }}</span>
            </div>
            <template v-if="auth.canTeach">
              <div class="d-form">
                <div class="d-field">
                  <label>本节课讲了什么</label>
                  <textarea v-model="record.content" class="d-textarea" placeholder="如：讲解牛顿第二定律典型题型，完成例题 6 道" />
                </div>
                <div class="d-field">
                  <label>布置的作业</label>
                  <textarea v-model="record.homework" class="d-textarea" style="min-height: 70px" placeholder="如：练习册 P45-46 第 1-8 题" />
                </div>
              </div>
              <div style="margin-top: 14px">
                <button class="d-btn primary" :disabled="savingRecord" @click="saveRecord">
                  {{ detail.record ? '更新记录' : '保存记录' }}
                </button>
              </div>
            </template>
            <template v-else>
              <div v-if="record.content" style="font-size: 14px; line-height: 1.8; white-space: pre-wrap">{{ record.content }}</div>
              <div v-if="record.homework" style="margin-top: 12px">
                <span class="d-badge warn">作业</span>
                <div style="font-size: 14px; line-height: 1.8; margin-top: 6px; white-space: pre-wrap">{{ record.homework }}</div>
              </div>
              <div v-if="!record.content && !record.homework" class="d-empty"><strong>老师还没有填写记录</strong></div>
            </template>
          </div>
        </div>

        <div class="d-col">
          <template v-if="auth.canTeach">
            <div class="d-card">
              <div class="d-card-title">
                <span>签到</span>
                <span class="d-badge" :class="checkedCount === detail.students.length && detail.students.length ? 'ok' : 'mute'">
                  已到 {{ checkedCount }}/{{ detail.students.length }} · 已签 {{ signedCount }}
                </span>
              </div>
              <div class="d-inline" style="margin-bottom: 12px">
                <button class="d-btn sm" @click="markAllPresent">全部到齐</button>
                <span style="font-size: 12.5px; color: #98a1b5">点「签名」请学生本人手写确认</span>
              </div>
              <div v-if="!detail.students.length" class="d-empty"><strong>班级还没有学生</strong></div>
              <div v-else style="max-height: 520px; overflow-y: auto">
                <table class="d-table">
                  <thead>
                    <tr><th>学生</th><th>状态</th><th class="actions">签名</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="s in detail.students" :key="s.id">
                      <td class="strong">{{ s.name }}</td>
                      <td>
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
                      </td>
                      <td class="actions">
                        <img v-if="signMap[s.id]" class="sign-thumb" :src="signMap[s.id]" alt="签名" @click="preview(signMap[s.id])" />
                        <button class="sign-btn" :class="{ done: !!signMap[s.id] }" @click="openSign(s.id, s.name)">
                          {{ signMap[s.id] ? '已签名' : '签名' }}
                        </button>
                        <button v-if="signMap[s.id]" class="d-btn sm danger" @click="clearSignature(s.id)">清</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <button
                v-if="detail.students.length"
                class="d-btn primary block" style="margin-top: 14px"
                :disabled="savingAttend" @click="pushAttendance(false)"
              >保存签到</button>
            </div>
          </template>

          <template v-else>
            <div class="d-card">
              <div class="d-card-title"><span>我的签到</span></div>
              <template v-if="myStudent && myAttendance">
                <div class="self-done">
                  <van-icon name="passed" size="19" color="#07c160" />
                  <div style="flex: 1">
                    <div style="font-weight: 600">已签到 · {{ ATTEND_STATUS[myAttendance]?.text }}</div>
                    <div style="font-size: 12.5px; color: #98a1b5; margin-top: 3px">如需修改可重新签到</div>
                  </div>
                  <button class="d-btn sm" @click="openSelf">重新签到</button>
                </div>
                <div v-if="mySignature" style="margin-top: 14px">
                  <div style="font-size: 12.5px; color: #5a6684; margin-bottom: 6px">我的签名</div>
                  <img class="trace-photo" style="height: 90px; object-fit: contain" :src="mySignature" alt="我的签名" @click="preview(mySignature)" />
                </div>
              </template>
              <template v-else-if="myStudent">
                <div class="d-empty" style="padding: 20px 10px"><strong>你还没有签到</strong>需要拍一张现场照片并手写签名</div>
                <button class="d-btn primary block" @click="openSelf">拍照 + 签名签到</button>
              </template>
              <div v-else class="d-empty"><strong>你不在本节课的班级中</strong></div>
              <div v-if="myStudent" style="margin-top: 14px">
                <button class="d-btn block" :disabled="detail.lesson.status === 'canceled'" @click="openLeave">
                  {{ detail.lesson.status === 'canceled' ? '本节课已取消，无需请假' : '这节课来不了？提交请假申请' }}
                </button>
              </div>
            </div>

            <div class="d-card">
              <div class="d-card-title">
                <span>本班签到</span>
                <span class="d-badge mute">已到 {{ checkedCount }}/{{ detail.students.length }}</span>
              </div>
              <div class="d-rows">
                <div v-for="s in detail.students" :key="s.id" class="d-row">
                  <div class="grow">
                    <div class="title">
                      {{ s.name }}
                      <span v-if="s.user_id === auth.user?.id" class="d-badge info" style="margin-left: 6px">我</span>
                    </div>
                  </div>
                  <span class="d-badge" :class="detail.attendance.find((a) => a.student_id === s.id)?.signed ? 'ok' : 'mute'">
                    {{ detail.attendance.find((a) => a.student_id === s.id)?.signed ? '已签' : '未签' }}
                  </span>
                  <span v-if="attendMap[s.id]" class="d-badge" :style="{ background: ATTEND_STATUS[attendMap[s.id]].color, color: '#fff' }">
                    {{ ATTEND_STATUS[attendMap[s.id]].text }}
                  </span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>

    <Modal
      v-model:show="sign.show"
      :title="sign.target === 'teacher' ? '教师签名' : `${sign.name} 的签名`"
      sub="用手指或鼠标在下方区域书写"
      @update:show="sign.show = $event"
    >
      <SignaturePad ref="signPad" :height="230" />
      <template #footer>
        <button class="d-btn" @click="sign.show = false">取消</button>
        <button class="d-btn primary" :disabled="savingSign" @click="confirmSign">确认签名</button>
      </template>
    </Modal>

    <Modal v-model:show="self.show" title="拍照 + 签名签到" sub="拍照与签名会作为出勤凭证保存" @update:show="self.show = $event">
      <div class="d-field" style="margin-bottom: 16px">
        <label>签到状态</label>
        <div class="seg">
          <span
            v-for="key in ['present', 'late', 'leave']"
            :key="key"
            class="seg-item"
            :class="{ on: self.status === key }"
            :style="self.status === key ? { background: ATTEND_STATUS[key].color } : {}"
            @click="self.status = key"
          >{{ ATTEND_STATUS[key].text }}</span>
        </div>
      </div>
      <div class="d-field" style="margin-bottom: 16px">
        <label>现场照片（选填）</label>
        <PhotoField v-model="self.photo" kind="photo" :max-size="1024" button-text="拍照" empty-text="可选：拍一张现场照片" :height="150" />
      </div>
      <div class="d-field">
        <label>手写签名{{ self.status === 'leave' ? '（请假可不签）' : '' }}</label>
        <SignaturePad ref="selfPad" :height="200" />
      </div>
      <template #footer>
        <button class="d-btn" @click="self.show = false">取消</button>
        <button class="d-btn primary" :disabled="self.saving" @click="submitSelf">提交签到</button>
      </template>
    </Modal>

    <Modal v-model:show="showDup" title="复制课时" sub="沿用时间、时长、教室与主题，不复制签到与留痕" size="narrow" @update:show="showDup = $event">
      <div class="d-field">
        <label>复制到哪一天</label>
        <input v-model="dupDate" type="date" class="d-input" />
      </div>
      <template #footer>
        <button class="d-btn" @click="showDup = false">取消</button>
        <button class="d-btn primary" @click="duplicate">复制</button>
      </template>
    </Modal>

    <Modal v-model:show="leave.show" title="提交请假申请" sub="老师审批通过后，这节课会记为「请假」" size="narrow" @update:show="leave.show = $event">
      <div class="d-field">
        <label>请假原因</label>
        <textarea v-model="leave.reason" class="d-textarea" placeholder="如：感冒发烧，需要休息" />
      </div>
      <template #footer>
        <button class="d-btn" @click="leave.show = false">取消</button>
        <button class="d-btn primary" :disabled="leave.saving" @click="submitLeave">提交申请</button>
      </template>
    </Modal>
  </div>
</template>
