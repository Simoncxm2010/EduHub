<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import api, { toastError } from '../api';
import { useAuthStore } from '../store';
import { isDesktop } from '../composables/layout';

const router = useRouter();
const auth = useAuthStore();
const classes = ref([]);
const loading = ref(true);

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

/* 创建班级（教师） */
const showCreate = ref(false);
const form = ref({ name: '', subject: '', description: '' });
const submitting = ref(false);

async function createClass() {
  if (!form.value.name.trim()) return showToast('请填写班级名称');
  submitting.value = true;
  try {
    await api.post('/classes', form.value);
    showToast({ type: 'success', message: '创建成功' });
    showCreate.value = false;
    form.value = { name: '', subject: '', description: '' };
    load();
  } catch (e) {
    toastError(e);
  } finally {
    submitting.value = false;
  }
}

/* 学生凭邀请码加入 */
const showJoin = ref(false);
const code = ref('');
const joining = ref(false);

async function joinClass() {
  if (!code.value.trim()) return showToast('请输入邀请码');
  joining.value = true;
  try {
    const d = await api.post('/classes/join', { invite_code: code.value.trim() });
    showToast({ type: 'success', message: `已加入「${d.class.name}」` });
    showJoin.value = false;
    code.value = '';
    load();
  } catch (e) {
    toastError(e);
  } finally {
    joining.value = false;
  }
}
</script>

<template>
  <div class="page">
    <template v-if="isDesktop">
      <div class="page-head">
        <div>
          <h1>班级</h1>
          <div class="sub">
            {{ auth.isTeacher ? `共 ${classes.length} 个班级，点击卡片查看学生名单与邀请码` : `已加入 ${classes.length} 个班级` }}
          </div>
        </div>
        <div class="page-head-actions">
          <van-button v-if="!auth.isTeacher" round type="primary" icon="plus" @click="showJoin = true">凭邀请码加入</van-button>
          <van-button v-if="auth.isTeacher" round type="primary" icon="plus" @click="showCreate = true">创建班级</van-button>
        </div>
      </div>
    </template>
    <van-nav-bar v-else title="班级" />

    <div v-if="!isDesktop && !auth.isTeacher" class="card" style="display: flex; align-items: center; gap: 10px">
      <van-icon name="invitation-o" size="22" color="#4f6ef2" />
      <div style="flex: 1">
        <div style="font-size: 14px; font-weight: 500">加入新班级</div>
        <div class="muted">输入老师提供的邀请码</div>
      </div>
      <van-button size="small" round type="primary" @click="showJoin = true">加入</van-button>
    </div>

    <van-loading v-if="loading" style="margin: 30px auto" vertical>加载中…</van-loading>
    <template v-else>
      <div :class="isDesktop ? 'grid-auto' : ''" :style="isDesktop ? { marginTop: '6px' } : {}">
        <div v-for="c in classes" :key="c.id" class="card class-card" @click="router.push(`/classes/${c.id}`)">
          <div class="class-chip" :style="{ background: c.color }">{{ c.name.slice(0, 1) }}</div>
          <div style="flex: 1; min-width: 0">
            <div class="class-name">{{ c.name }}</div>
            <div class="class-info">
              <span v-if="c.subject">科目：{{ c.subject }}</span>
              <span>学生 {{ c.student_count }} 人</span>
              <span v-if="c.next_lesson_date">下次课 {{ c.next_lesson_date }}</span>
            </div>
          </div>
          <van-icon name="arrow" color="#c3c9d6" />
        </div>
      </div>
      <van-empty
        v-if="!classes.length"
        image="search"
        :description="auth.isTeacher ? '还没有班级，点击下方按钮创建' : '还没有加入任何班级'"
      />
    </template>

    <button v-if="!isDesktop && auth.isTeacher" class="fab" @click="showCreate = true">+</button>

    <van-popup
      v-model:show="showCreate"
      round
      class="eduhub-popup"
      :position="isDesktop ? 'center' : 'bottom'"
      style="padding: 18px 4px 24px"
    >
      <div class="form-title">创建班级</div>
      <van-cell-group inset>
        <van-field v-model="form.name" label="名称" placeholder="如：初二物理培优班" clearable />
        <van-field v-model="form.subject" label="科目" placeholder="如：物理（选填）" clearable />
        <van-field v-model="form.description" label="简介" placeholder="班级说明（选填）" clearable />
      </van-cell-group>
      <div style="margin: 16px">
        <van-button round block type="primary" :loading="submitting" @click="createClass">创建</van-button>
      </div>
    </van-popup>

    <van-popup
      v-model:show="showJoin"
      round
      class="eduhub-popup"
      :position="isDesktop ? 'center' : 'bottom'"
      style="padding: 18px 4px 24px"
    >
      <div class="form-title">输入邀请码加入班级</div>
      <van-cell-group inset>
        <van-field v-model="code" label="邀请码" placeholder="6 位字母数字" clearable />
      </van-cell-group>
      <div style="margin: 16px">
        <van-button round block type="primary" :loading="joining" @click="joinClass">加入班级</van-button>
      </div>
    </van-popup>
  </div>
</template>
