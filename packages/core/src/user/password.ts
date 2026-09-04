import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto"

// scrypt 参数（OWASP 2024 推荐：N=2^14, r=8, p=1）
// 用 node:crypto.scryptSync 跨平台，避免 @node-rs/argon2 在 bun build 跨平台打包时
// 硬编码 Windows native binding 路径，导致 Linux 容器启动崩（TypeError: must be absolute path）
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 } as const

// 把 scryptSync 异步化以便跟原 argon2 异步签名保持一致
// 生成 PHC 标准格式 "scrypt$N=..$r=..$p=..$saltHex$hashHex"，与外部工具兼容
export function hashPassword(pwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const salt = randomBytes(16)
      const hash = scryptSync(pwd, salt, SCRYPT_PARAMS.keylen, {
        N: SCRYPT_PARAMS.N,
        r: SCRYPT_PARAMS.r,
        p: SCRYPT_PARAMS.p,
      })
      resolve(`scrypt$N=${SCRYPT_PARAMS.N}$r=${SCRYPT_PARAMS.r}$p=${SCRYPT_PARAMS.p}$${salt.toString("hex")}$${hash.toString("hex")}`)
    } catch (e) {
      reject(e)
    }
  })
}

export function verifyPasswordHash(stored: string, pwd: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    try {
      // 支持两种格式：
      // 1. 本项目 hashPassword 生成的 "saltHex:hashHex" 格式
      // 2. PHC 标准格式 "scrypt$N=..$r=..$p=..$saltHex$hashHex"（外部工具/旧数据）
      let saltHex: string
      let hashHex: string
      let params: { N: number; r: number; p: number } = { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p }
      if (stored.startsWith("scrypt$")) {
        // PHC 格式：scrypt$N=..$r=..$p=..$salt$hash
        const parts = stored.split("$")
        // parts[0]="scrypt", parts[1]="N=..", parts[2]="r=..", parts[3]="p=..", parts[4]=salt, parts[5]=hash
        for (let i = 1; i <= 3; i++) {
          const [k, v] = parts[i]!.split("=")
          if (k === "N") params.N = Number(v)
          else if (k === "r") params.r = Number(v)
          else if (k === "p") params.p = Number(v)
        }
        saltHex = parts[4]!
        hashHex = parts[5]!
      } else {
        // 冒号格式：saltHex:hashHex
        const parts = stored.split(":")
        saltHex = parts[0]!
        hashHex = parts[1]!
      }
      if (!saltHex || !hashHex) return resolve(false)
      const salt = Buffer.from(saltHex, "hex")
      const expected = Buffer.from(hashHex, "hex")
      const actual = scryptSync(pwd, salt, expected.length, params)
      resolve(actual.length === expected.length && timingSafeEqual(actual, expected))
    } catch (e) {
      reject(e)
    }
  })
}

// 密码强度校验：至少 8 位 + 含字母 + 含数字
export function validatePassword(pwd: string): boolean {
  return pwd.length >= 8 && /[a-zA-Z]/.test(pwd) && /[0-9]/.test(pwd)
}

export * as Password from "./password"
