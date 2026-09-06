import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { classifyTask, type PairDecision } from "./classify.js";

/**
 * Второй мозг: независимый проверяющий другого семейства на задачах, где ошибка
 * дорога. Работает сам, человек в этом не участвует.
 *
 * Устройство и его причины (подробности в PLUGIN_OVERVIEW.md):
 * - проверяющий запускается ПОСЛЕ первого хода автора, иначе ему нечего
 *   проверять; он получает исходную задачу и рабочую папку, но НЕ получает
 *   вывод автора — измеренный эффект якоря у моделей сильнее человеческого,
 *   и увидев чужой ответ, проверяющий соглашается вместо проверки;
 * - семейство всегда другое: однородная пара усиливает общую ошибку;
 * - у каждой находки обязано быть доказательство (файл, строка, команда):
 *   в ретроспективе один непроверяемый слой дал 60% ложных находок;
 * - суточный бюджет: подписка проверяющего кончается быстрее, чем идут задачи,
 *   и её надо тратить на дорогие классы, а не на все подряд.
 */

/** Сколько проверок в сутки допускаем. Подписка Codex кончалась на седьмом
 * треде за день, поэтому бюджет заметно ниже числа задач. */
const БЮДЖЕТ_В_СУТКИ = 6;
const КЛЮЧ_БЮДЖЕТА = "budget";
const КЛЮЧ_ПРОВЕРКИ = "review:";

interface Бюджет {
  day: string;
  used: number;
}

interface Проверка {
  parentThreadId: string;
  taskClass: string;
  round: number;
  maxRounds: number;
  startedAt: number;
}

function сегодня(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function бюджетПозволяет(
  бюджет: Бюджет | undefined,
  now = Date.now(),
  предел = БЮДЖЕТ_В_СУТКИ,
): boolean {
  if (бюджет === undefined || бюджет.day !== сегодня(now)) return true;
  return бюджет.used < предел;
}

export function следующийБюджет(
  бюджет: Бюджет | undefined,
  now = Date.now(),
): Бюджет {
  const день = сегодня(now);
  if (бюджет === undefined || бюджет.day !== день) return { day: день, used: 1 };
  return { day: день, used: бюджет.used + 1 };
}

/**
 * Возврат бюджета: проверка, которая не состоялась, его не тратит.
 * Повод (07.09.2026): недельный лимит Codex был выбран на 100%, дочерние треды
 * падали бы сразу, и шесть падений за час выключили бы второй мозг на сутки —
 * ровно тогда, когда лимит восстановится и проверять снова стало бы можно.
 */
export function вернутьБюджет(
  бюджет: Бюджет | undefined,
  now = Date.now(),
): Бюджет | undefined {
  if (бюджет === undefined || бюджет.day !== сегодня(now)) return бюджет;
  if (бюджет.used <= 0) return бюджет;
  return { day: бюджет.day, used: бюджет.used - 1 };
}

interface РядЛенты {
  kind?: string;
  role?: string;
  text?: string;
  children?: РядЛенты[] | null;
}

/** Первый запрос человека в треде: по нему судим о классе задачи. */
export function первыйЗапрос(rows: readonly РядЛенты[]): string | undefined {
  const обойти = (ряд: РядЛенты): string | undefined => {
    if (ряд.kind === "conversation" && ряд.role === "user") {
      const текст = (ряд.text ?? "").trim();
      return текст.length > 0 ? текст : undefined;
    }
    if (ряд.kind === "turn" && ряд.children != null) {
      for (const ребёнок of ряд.children) {
        const найдено = обойти(ребёнок);
        if (найдено !== undefined) return найдено;
      }
    }
    return undefined;
  };
  for (const ряд of rows) {
    const найдено = обойти(ряд);
    if (найдено !== undefined) return найдено;
  }
  return undefined;
}

/** Задание проверяющему. Намеренно не содержит вывода автора. */
export function заданиеПроверяющему(args: {
  задача: string;
  класс: string;
  почему: string;
  раунд: number;
}): string {
  return [
    "Ты независимый проверяющий. Твоя работа — не выполнить задачу заново, а найти в её решении то,",
    "что дорого стоит: неверный факт, число, которое не сходится с источником, обещание без механизма,",
    "пропущенный шаг, необратимое действие без страховки.",
    "",
    `Класс задачи: ${args.класс}. Почему тебя позвали: ${args.почему}.`,
    args.раунд > 1
      ? "Это второй раунд: первый дал расхождение. Разбери только спорные пункты."
      : "Работай ВСЛЕПУЮ: смотри саму задачу и артефакты в рабочей папке, а не чужие выводы.",
    "",
    "Исходная задача человека, дословно:",
    "---",
    args.задача.slice(0, 4000),
    "---",
    "",
    "Правила ответа, они жёсткие:",
    "1. У КАЖДОЙ находки должно быть доказательство: путь к файлу со строкой, вывод команды или запись",
    "   журнала. Находку без доказательства не пиши вовсе — непроверяемый слой даёт больше шума, чем пользы.",
    "2. Сначала строка вердикта: «расхождений не нашёл» либо «нашёл N, из них блокирующих M».",
    "3. Дальше находки по убыванию цены ошибки, каждая: что не так, чем доказано, что будет с человеком.",
    "4. Ничего не чини и не запускай сам: ни правок, ни перезапусков, ни отправки наружу. Только чтение.",
    "5. Пиши по-русски и коротко.",
  ].join("\n");
}

/** Сообщение автору с находками проверяющего. */
export function сводкаДляАвтора(args: {
  класс: string;
  вывод: string;
  раунд: number;
}): string {
  return [
    `**Второй мозг · ${args.класс}${args.раунд > 1 ? ` · раунд ${args.раунд}` : ""}**`,
    "",
    "Независимая проверка другой моделью, вслепую. Разбери каждую находку:",
    "подтверди с доказательством или отклони с доказательством, и скажи об этом человеку.",
    "",
    args.вывод.trim(),
  ].join("\n");
}

export default async function plugin(bb: BbPluginApi) {
  const хранилище = bb.storage.kv;

  async function запуститьПроверку(thread: {
    id: string;
    projectId: string | null;
    providerId: string | null;
    environmentId: string | null;
  }): Promise<void> {
    const бюджет = await хранилище.get<Бюджет>(КЛЮЧ_БЮДЖЕТА);
    if (!бюджетПозволяет(бюджет)) {
      bb.log.info(
        `второй мозг пропущен для ${thread.id}: суточный бюджет проверок исчерпан`,
      );
      return;
    }

    const лента = await bb.sdk.threads.timeline({
      threadId: thread.id,
      includeNestedRows: "true",
    });
    const задача = первыйЗапрос(лента.rows as РядЛенты[]);
    if (задача === undefined) return;

    const решение: PairDecision = classifyTask({
      prompt: задача,
      parentProvider: thread.providerId ?? "",
    });
    if (!решение.pair || решение.provider === undefined) {
      bb.log.info(
        `второй мозг не нужен для ${thread.id}: ${решение.taskClass} — ${решение.why}`,
      );
      return;
    }

    if (thread.projectId === null) return;
    const ребёнок = await bb.sdk.threads.spawn({
      projectId: thread.projectId,
      // Та же папка, что у автора: проверяющий смотрит те же артефакты, а не
      // пустое новое рабочее дерево.
      environment:
        thread.environmentId === null
          ? { type: "project-default" }
          : { type: "reuse", environmentId: thread.environmentId },
      parentThreadId: thread.id,
      title: `Проверка · ${решение.taskClass}`,
      prompt: заданиеПроверяющему({
        задача,
        класс: решение.taskClass,
        почему: решение.why,
        раунд: 1,
      }),
      providerId: решение.provider,
      ...(решение.model === undefined ? {} : { model: решение.model }),
      ...(решение.reasoningLevel === undefined
        ? {}
        : { reasoningLevel: решение.reasoningLevel }),
    });

    await хранилище.set(КЛЮЧ_БЮДЖЕТА, следующийБюджет(бюджет));
    await хранилище.set(`${КЛЮЧ_ПРОВЕРКИ}${ребёнок.id}`, {
      parentThreadId: thread.id,
      taskClass: решение.taskClass,
      round: 1,
      maxRounds: решение.maxRounds ?? 1,
      startedAt: Date.now(),
    } satisfies Проверка);
    // Метка на родителе, чтобы второй ход того же треда не порождал вторую проверку.
    await хранилище.set(`${КЛЮЧ_ПРОВЕРКИ}parent:${thread.id}`, {
      childThreadId: ребёнок.id,
      at: Date.now(),
    });
    bb.log.info(
      `второй мозг: ${решение.provider}/${решение.model} проверяет ${thread.id} (${решение.taskClass})`,
    );
  }

  async function вернутьНаходки(threadId: string): Promise<void> {
    const проверка = await хранилище.get<Проверка>(`${КЛЮЧ_ПРОВЕРКИ}${threadId}`);
    if (проверка === undefined) return;
    await хранилище.delete(`${КЛЮЧ_ПРОВЕРКИ}${threadId}`);
    let вывод = "";
    try {
      const результат = await bb.sdk.threads.output({ threadId });
      вывод = (результат.output ?? "").trim();
    } catch (error) {
      bb.log.warn(
        `второй мозг: не прочитал вывод ${threadId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    if (вывод.length === 0) return;
    // Молчание проверяющего это тоже результат, но человека им не тревожим:
    // в родителя уходит только то, что требует разбора.
    if (/расхождений не нашёл/i.test(вывод) && вывод.length < 400) {
      bb.log.info(`второй мозг: ${threadId} расхождений не нашёл`);
      return;
    }
    await bb.sdk.threads.send({
      threadId: проверка.parentThreadId,
      mode: "steer-if-active",
      input: [
        {
          type: "text",
          mentions: [],
          text: сводкаДляАвтора({
            класс: проверка.taskClass,
            вывод,
            раунд: проверка.round,
          }),
        },
      ],
    });
  }

  bb.events.on("thread.idle", ({ thread }) => {
    void (async () => {
      try {
        const это_проверка = await хранилище.get<Проверка>(
          `${КЛЮЧ_ПРОВЕРКИ}${thread.id}`,
        );
        if (это_проверка !== undefined) {
          await вернутьНаходки(thread.id);
          return;
        }
        if (thread.parentThreadId != null) return;
        if (thread.visibility !== "visible") return;
        const уже = await хранилище.get(`${КЛЮЧ_ПРОВЕРКИ}parent:${thread.id}`);
        if (уже !== undefined) return;
        await запуститьПроверку({
          id: thread.id,
          projectId: thread.projectId ?? null,
          providerId: thread.providerId ?? null,
          environmentId: thread.environmentId ?? null,
        });
      } catch (error) {
        // Сбой второго мозга не должен мешать основной работе человека.
        bb.log.warn(
          `второй мозг пропущен: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    })();
  });

  bb.events.on("thread.failed", ({ thread }) => {
    void (async () => {
      try {
        const проверка = await хранилище.get<Проверка>(
          `${КЛЮЧ_ПРОВЕРКИ}${thread.id}`,
        );
        if (проверка === undefined) return;
        await хранилище.delete(`${КЛЮЧ_ПРОВЕРКИ}${thread.id}`);
        // Метку на родителе тоже снимаем: иначе один упавший проверяющий
        // навсегда закрывает этому треду дорогу ко второму мозгу.
        await хранилище.delete(`${КЛЮЧ_ПРОВЕРКИ}parent:${проверка.parentThreadId}`);
        // Не состоявшаяся проверка бюджета не тратит, иначе кончившийся лимит
        // проверяющего выключает второй мозг на сутки вперёд.
        const бюджет = await хранилище.get<Бюджет>(КЛЮЧ_БЮДЖЕТА);
        const возврат = вернутьБюджет(бюджет);
        if (возврат !== undefined) await хранилище.set(КЛЮЧ_БЮДЖЕТА, возврат);
        // Падение проверяющего (кончился лимит, оборвалась связь) не повод
        // дёргать человека: каждый десятый дочерний тред падает.
        bb.log.info(`второй мозг: проверка ${thread.id} не состоялась, бюджет возвращён`);
      } catch {
        /* тишина намеренно: это уже путь обработки ошибки */
      }
    })();
  });
}
