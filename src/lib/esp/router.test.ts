import { describe, expect, it } from "vitest";
import { routeSkill } from "./router";

describe("routeSkill", () => {
  it("routes a policy request to the governed knowledge skill", () => {
    const result = routeSkill("请查询公司的休假制度", ["knowledge.read"]);

    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.skill.id).toBe("search-company-policy");
      expect(result.requiresConfirmation).toBe(false);
    }
  });

  it.each([
    ["公司的年假和考勤规则", "search-company-policy"],
    ["出差发票怎么报销", "search-expense-policy"],
    ["新供应商的采购流程", "search-procurement-guide"],
    ["收到钓鱼邮件如何处理", "search-security-guidance"],
    ["查询批准软件目录", "search-software-catalog"],
    ["ticket status for INC-2048", "get-ticket-status"],
    ["create ticket for a broken laptop", "create-it-ticket"],
  ])("routes scenario %s to %s", (query, expectedSkill) => {
    const result = routeSkill(query, [
      "knowledge.read",
      "tickets.read",
      "tickets.create",
    ]);

    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.skill.id).toBe(expectedSkill);
    }
  });

  it("does not reveal a matching skill without its permission", () => {
    const result = routeSkill("请帮我创建工单", ["tickets.read"]);

    expect(result).toEqual({
      status: "no_match",
      confidence: 0,
      reason: "未找到当前用户有权使用的匹配技能。",
    });
  });

  it("requires confirmation for a write action", () => {
    const result = routeSkill("电脑故障，请创建工单", ["tickets.create"]);

    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.skill.id).toBe("create-it-ticket");
      expect(result.requiresConfirmation).toBe(true);
    }
  });
});