/**
 * 把 11 位中国大陆手机号中间 4 位打码显示。
 * 入参：phone — 字符串形式手机号
 * 返回：打码后字符串；若格式不符则原样返回
 * 示例：maskPhone("13826001876") === "138****1876"
 */
export function maskPhone(phone: string): string {
  if (!/^1\d{10}$/.test(phone)) return phone
  return phone.slice(0, 3) + "****" + phone.slice(7)
}