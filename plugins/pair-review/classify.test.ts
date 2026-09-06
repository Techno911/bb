import { describe, expect, it } from "vitest";

import { classifyTask, verifierFor } from "./classify.js";

describe("решение о втором мозге", () => {
  it("зовёт проверяющего там, где ошибка стоит денег", () => {
    const решение = classifyTask({
      prompt: "посчитай сумму возврата по гарантии для клиента и собери смету",
      parentProvider: "claude-code",
    });
    expect(решение.pair).toBe(true);
    expect(решение.taskClass).toBe("деньги-и-обещания");
    expect(решение.reasoningLevel).toBe("xhigh");
    expect(решение.maxRounds).toBe(2);
  });

  it("зовёт проверяющего на диагностике: вторая модель ищет иначе", () => {
    const решение = classifyTask({
      prompt: "почему упали треды, разберись что сломалось",
      parentProvider: "claude-code",
    });
    expect(решение.pair).toBe(true);
    expect(решение.taskClass).toBe("диагностика");
  });

  it("молчит на рутине: там базовая точность и так высокая", () => {
    for (const запрос of [
      "покажи статус сервера",
      "найди файл с настройками",
      "переименуй папку в архив",
    ]) {
      const решение = classifyTask({ prompt: запрос, parentProvider: "claude-code" });
      expect(решение.pair, запрос).toBe(false);
      expect(решение.taskClass, запрос).toBe("рутина");
    }
  });

  it("проверяющий всегда другого семейства", () => {
    expect(verifierFor("claude-code")?.provider).toBe("codex");
    expect(verifierFor("codex")?.provider).toBe("claude-code");
    // Однородная пара запрещена по данным: 65% провалов многоагентного обмена
    // это «коллективное заблуждение» агентов одного рода.
    expect(verifierFor("claude-code")?.provider).not.toBe("claude-code");
    expect(verifierFor("codex")?.provider).not.toBe("codex");
  });

  it("не берётся за провайдера, для которого пары не задано", () => {
    const решение = classifyTask({
      prompt: "посчитай сумму договора",
      parentProvider: "pi",
    });
    expect(решение.pair).toBe(false);
    expect(решение.why).toContain("другого семейства не задан");
  });

  it("длинная задача со словом «покажи» рутиной не считается", () => {
    const решение = classifyTask({
      prompt:
        "покажи, как устроен расчёт возврата по гарантии, и проверь, совпадает ли он с договором клиента, потому что в отчёте стоит другая сумма и её уже видел собственник",
      parentProvider: "claude-code",
    });
    expect(решение.pair).toBe(true);
  });

  it("правка общей системы идёт с меньшей мощностью и одним раундом", () => {
    const решение = classifyTask({
      prompt: "сделай системный фикс правила выката, чтобы это не повторялось",
      parentProvider: "claude-code",
    });
    expect(решение.pair).toBe(true);
    expect(решение.taskClass).toBe("общая-система");
    expect(решение.maxRounds).toBe(1);
  });
});
