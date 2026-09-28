<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import Modal from '../../ui/Modal.vue';

const router = useRouter();
const auth = useAuthStore();
const classes = ref([]);
const loading = ref(true);

const showCreate = ref(false);
const showJoin = ref(false);
const form = ref({ name: '', subject: '', description: '', rate: 0 });
const code = ref('');
const busy = ref(false);

async function load() {
  loading.value = true;
  try {
    const d = await api.get('/classes');
    classes.value = d.classes;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function createClass() {
  if (!form.value.name.trim()) return showToast('请填写班级名称');
  busy.value = true;
  try {
    await api.post('/classes', form.value);
    showToast({ type: 'success', message: '创建成功' });
    showCreate.value = false;
    form.value = { name: '', subject: '', description: '', rate: 0 };
    load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function joinClass() {
  if (!code.value.trim()) return showToast('请输入邀请码');
  busy.value = true;
  try {
    const d = await api.post('/classes/join', { invite_code: code.value.trim() });
    showToast({ type: 'success', message: `已加入「${d.class.name}」` });
    showJoin.value = false;
    code.value = '';
    load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function removeClass(c) {
  try {
    await showConfirmDialog({
      title: '删除班级',
      message: `删除「${c.name}」会同时删除其排课、签到与课堂记录，确定吗？`,
      confirmButtonText: '确认删除',
    });
  } catch {
    return;
  }
  try {
    await api.delete(`/classes/${c.id}`);
    showToast('已删除');
    load();
  } catch (e) {
    toastError(e);
  }
}
</script>

<template>
  <div class="d-page">
    <div class="d-head">
      <div>
        <h1>班级</h1>
        <div class="sub">
          {{ auth.canTeach ? `共 ${classes.length} 个班级` : `已加入 ${classes.length} 个班级` }}
          <template v-if="auth.isAdmin"> · 管理员可见全部班级</template>
        </div>
      </div>
      <div class="d-head-actions">
        <button v-if="auth.isStudent" class="d-btn primary" @click="showJoin = true">凭邀请码加入班级</button>
        <button v-if="auth.canTeach" class="d-btn primary" @click="showCreate = true">创建班级</button>
      </div>
    </div>

    <div class="d-card">
      <div v-if="loading" class="d-empty">加载中…</div>
      <div v-else-if="!classes.length" class="d-empty">
        <strong>{{ auth.canTeach ? '还没有班级' : '还没有加入任何班级' }}</strong>
        {{ auth.canTeach ? '点右上角「创建班级」，然后把邀请码发给学生' : '向老师索取邀请码后加入' }}
      </div>
      <div v-else class="d-scroll">
        <table class="d-table">
          <thead>
            <tr>
              <th>班级</th>
              <th>科目</th>
              <th v-if="!auth.isStudent">授课老师</th>
              <th class="center">学生</th>
              <th>下次课</th>
              <th v-if="auth.canTeach" class="num">单节课酬</th>
              <th v-if="auth.canTeach" class="actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in classes" :key="c.id">
              <td>
                <span class="d-dot" :style="{ background: c.color, marginRight: '8px' }" />
                <span class="strong" style="cursor: pointer" @click="router.push(`/classes/${c.id}`)">{{ c.name }}</span>
                <div v-if="c.description" class="meta" style="color: #98a1b5; font-size: 12px; margin-top: 3px">{{ c.description }}</div>
              </td>
              <td>{{ c.subject || '—' }}</td>
              <td v-if="!auth.isStudent">{{ c.teacher_name || '—' }}</td>
              <td class="center">{{ c.student_count }}</td>
              <td>{{ c.next_lesson_date || '—' }}</td>
              <td v-if="auth.canTeach" class="num">{{ c.rate ? `${c.rate} 元` : '—' }}</td>
              <td v-if="auth.canTeach" class="actions">
                <button class="d-btn sm" @click="router.push(`/classes/${c.id}`)">详情</button>
                <button class="d-btn sm danger" @click="removeClass(c)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal v-model:show="showCreate" title="创建班级" sub="创建后会生成邀请码，学生凭邀请码加入" @update:show="showCreate = $event">
      <div class="d-form two">
        <div class="d-field">
          <label>班级名称 *</label>
          <input v-model="form.name" class="d-input" placeholder="如：初二物理培优班" />
        </div>
        <div class="d-field">
          <label>科目</label>
          <input v-model="form.subject" class="d-input" placeholder="如：物理" />
        </div>
        <div class="d-field">
          <label>单节课酬（元）</label>
          <input v-model.number="form.rate" type="number" min="0" class="d-input" placeholder="用于统计本月课酬，可留空" />
        </div>
        <div class="d-field">
          <label>班级简介</label>
          <input v-model="form.description" class="d-input" placeholder="选填" />
        </div>
      </div>
      <template #footer>
        <button class="d-btn" @click="showCreate = false">取消</button>
        <button class="d-btn primary" :disabled="busy" @click="createClass">创建</button>
      </template>
    </Modal>

    <Modal v-model:show="showJoin" title="加入班级" sub="输入老师提供的 6 位邀请码" size="narrow" @update:show="showJoin = $event">
      <div class="d-field">
        <label>邀请码</label>
        <input v-model="code" class="d-input" placeholder="如：DEMO66" @keyup.enter="joinClass" />
      </div>
      <template #footer>
        <button class="d-btn" @click="showJoin = false">取消</button>
        <button class="d-btn primary" :disabled="busy" @click="joinClass">加入</button>
      </template>
    </Modal>
  </div>
</template>
