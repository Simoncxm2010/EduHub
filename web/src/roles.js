/** 角色等级：与后端 ROLE_LEVEL 保持一致，用于判断能否管理某个账号 */
export const ROLE_LEVEL_LABEL = { student: 1, teacher: 2, admin: 3, super: 4 };

export const ROLE_CN = { student: '学生', teacher: '教师', admin: '管理员', super: '超级管理员' };

export function roleLabel(role) {
  return ROLE_CN[role] || role;
}
