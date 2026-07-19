// 自定义（yejian）：把当前登录用户信息格式化成系统提示词片段
// 目的：会话输出文件需放在用户实名文件夹内 / 需用实名命名产物，
//       但用户不愿每次在提示词框手动告诉大模型自己是谁。
// 做法：每次 loop 拼装 system prompt 时，根据 session.user_id 查出用户信息，
//       追加 <current_user> 块；主对话和子代理（plan/explore/general/task）全部继承。
import type { UserInfo } from "@opencode-ai/core/user"

/**
 * 把当前登录用户格式化为系统提示词片段。
 * 输出形如：
 *   <current_user>
 *     username: 上官兵
 *     display_name: 上官兵
 *     role: user
 *     user_id: usr_上官兵
 *     当需要按用户实名命名输出文件、目录、报告、邮件等产物时，
 *     必须使用上面的 display_name（实名）作为标识。
 *   </current_user>
 */
export function formatUserContext(user: UserInfo): string {
  const display = user.display_name ?? user.username
  return [
    "<current_user>",
    `  username: ${user.username}`,
    `  display_name: ${display}`,
    `  role: ${user.role}`,
    `  user_id: ${user.id}`,
    "  当需要按用户实名命名输出文件、目录、报告、邮件等产物时，必须使用上面的 display_name（实名）作为标识。",
    "</current_user>",
  ].join("\n")
}
