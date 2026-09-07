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

  it("не путает бытовое слово с действием над системой", () => {
    // Найдено сухим прогоном по живой базе 07.09.2026: «Картофель 1,3 кг
    // очистить» уходило в класс «необратимое» на xhigh, а «Соберись и работай
    // аккуратнее» — в «сдачу артефакта». Оба ложных срабатывания тратили бы
    // дорогой слот бюджета.
    for (const запрос of [
      '"Картофель 1,3 кг очистить" даже я вижу, что не будет на выходе 1,25 кг',
      "В чем дело? Соберись и работай всегда профессиональнее и аккуратнее",
    ]) {
      expect(classifyTask({ prompt: запрос, parentProvider: "claude-code" }).pair, запрос).toBe(false);
    }
  });

  it("настоящее действие над системой по-прежнему ловится", () => {
    for (const [запрос, класс] of [
      ["очисти базу от старых записей", "необратимое"],
      ["задеплой на прод", "необратимое"],
      ["удали папку с архивом", "необратимое"],
    ] as const) {
      const решение = classifyTask({ prompt: запрос, parentProvider: "claude-code" });
      expect(решение.pair, запрос).toBe(true);
      expect(решение.taskClass, запрос).toBe(класс);
    }
  });

  it("признаки с границей слова работают в кириллице", () => {
    // \b опирается на ASCII-класс \w, поэтому «пост\b» и «прод\b» не
    // находили НИЧЕГО: правила молча не срабатывали, и это читалось как
    // «признак не встретился».
    expect(classifyTask({ prompt: "выложи пост в канал", parentProvider: "claude-code" }).taskClass).toBe("сдача-артефакта");
    expect(classifyTask({ prompt: "выкати на прод", parentProvider: "claude-code" }).taskClass).toBe("необратимое");
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
