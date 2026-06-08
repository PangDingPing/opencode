import { describe, expect, test } from "bun:test"
import { maskPhone } from "./phoneMask"

describe("maskPhone", () => {
  test("标准 11 位手机号打码", () => {
    expect(maskPhone("13826001876")).toBe("138****1876")
  })
  test("非法格式原样返回", () => {
    expect(maskPhone("123")).toBe("123")
    expect(maskPhone("")).toBe("")
    expect(maskPhone("23826001876")).toBe("23826001876") // 不以 1 开头
    expect(maskPhone("138260018")).toBe("138260018")   // 9 位，不是 11
  })
})