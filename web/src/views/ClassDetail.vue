<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import api, { toastError } from '../api';
import { useAuthStore } from '../store';
import { isDesktop } from '../composables/layout';
import { addDays, fmtDate } from '../utils';
import LessonCard from '../components/LessonCard.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const classId = Number(route.params.id);

const info = ref(null);
const upcoming = ref([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    info.value = await api.get(`/classes/${classId}`);
    const from = fmtDate(new Date());
    const d = await api.get('/lessons', { params: { from, to: addDays(from, 60), class_id: classId } });
    upcoming.value = d.lessons.slice(0, isDesktop.value ? 8 : 5);
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function copyCode() {
  try {
    await navigator.clipboard.writeText(info.value.class.invite_code);
    showToast('邀请码已复制');
  } catch {
    showToast(`邀请码：${info.value.class.invite_code}`);
  }
}

/* 学生管理（教师） */
const showAdd = ref(false);
const form = ref({ name: '', phone: '', remark: '' });
const saving = ref(false);

async function addStudent() {
  if (!form.value.name.trim()) return showToast('请填写学生姓名');
  saving.value = true;
  try {
    await api.post(`/classes/${classId}/students`, form.value);
    showToast({ type: 'success', message: '已添加' });
    showAdd.value = false;
    form.value = { name: '', phone: '', remark: '' };
    load();
  } catch (e) {
    toastError(e);
  } finally {
    saving.value = false;
  }
}

async function removeStudent(s) {
  try {
    await showConfirmDialog({ title: '移除学生', message: `确定将「${s.name}」移出班级吗？` });
  } catch {
    return;
  }
  try {
    await api.delete(`/classes/${classId}/students/${s.id}`);
    showToast('已移除');
    load();
  } catch (e) {
    toastError(e);
  }
}

const subjectTag = computed(() => info.value?.class?.subject || '课程');
</script>

<template>
  <div class="page">
    <van-nav-bar title="班级详情" left-arrow @click-left="router.back()" />

    <van-loading v-if="loading" style="margin: 30px auto" vertical>加载中…</van-loading>
    <template v-else-if="info">
      <div class="split">
        <div class="col">
          <div class="card" style="display: flex; gap: 12px; align-items: center">
            <div class="class-chip" :style="{ background: info.class.color }">{{ info.class.name.slice(0, 1) }}</div>
            <div style="flex: 1; min-width: 0">
              <div class="class-name">{{ info.class.name }}</div>
              <div class="class-info">
                <van-tag plain type="primary">{{ subjectTag }}</van-tag>
                <span>学生 {{ info.students.length }} 人</span>
              </div>
            </div>
          </div>
          <div v-if="info.class.description" class="card muted">{{ info.class.description }}</div>

          <div v-if="auth.isTeacher" class="card">
            <div style="display: flex; align-items: center; justify-content: space-between">
              <span style="font-size: 14px; font-weight: 600">班级邀请码</span>
              <van-tag plain type="primary" style="cursor: pointer" @click="copyCode">点击复制</van-tag>
            </div>
            <div class="invite-code">{{ info.class.invite_code }}</div>
            <div class="muted" style="text-align: center">学生注册后，在「班级」页输入邀请码即可加入</div>
          </div>
        </div>

        <div class="col">
          <div class="section-head" style="margin-top: 0">
            <span>学生名单</span>
            <van-tag v-if="auth.isTeacher" plain type="primary" style="cursor: pointer" @click="showAdd = true">+ 添加</van-tag>
          </div>
          <div class="card card-tight">
            <div v-for="s in info.students" :key="s.id" class="attend-row">
              <div class="attend-name">
                <span>{{ s.name }}</span>
                <van-tag v-if="s.phone" plain>{{ s.phone }}</van-tag>
              </div>
              <div class="attend-actions">
                <van-tag v-if="s.user_id" plain type="success">已绑定账号</van-tag>
                <span v-else class="muted">未绑定</span>
                <van-icon v-if="auth.isTeacher" name="delete-o" color="#ee0a24" size="18" style="cursor: pointer" @click="removeStudent(s)" />
              </div>
            </div>
            <van-empty v-if="!info.students.length" image="search" description="暂无学生" style="padding: 20px 0" />
          </div>
        </div>
      </div>

      <div class="section-head">
        <span>近期课时</span>
        <span class="link" @click="router.push('/schedule')">全部排课 ›</span>
      </div>
      <div :class="isDesktop ? 'grid-auto' : ''">
        <LessonCard v-for="l in upcoming" :key="l.id" :lesson="l" :show-date="true" />
      </div>
      <van-empty v-if="!upcoming.length" image="search" description="暂无排课" style="padding: 16px 0" />
    </template>

    <van-popup
      v-model:show="showAdd"
      round
      class="eduhub-popup"
      :position="isDesktop ? 'center' : 'bottom'"
      style="padding: 18px 4px 24px"
    >
      <div class="form-title">添加学生</div>
      <van-cell-group inset>
        <van-field v-model="form.name" label="姓名" placeholder="学生姓名" clearable />
        <van-field v-model="form.phone" label="手机号" placeholder="选填" clearable />
        <van-field v-model="form.remark" label="备注" placeholder="选填" clearable />
      </van-cell-group>
      <div class="muted" style="margin: 10px 20px 0">学生也可以自行注册后用邀请码加入班级。</div>
      <div style="margin: 16px">
        <van-button round block type="primary" :loading="saving" @click="addStudent">添加</van-button>
      </div>
    </van-popup>
  </div>
</template>
