/**
 * Откуда пара берёт расход лимитов.
 *
 * Источник ОДИН: плагин «Лимиты», который уже опрашивает Claude по
 * /api/oauth/usage и читает файлы сессий Codex, и держит снимок у себя. Пара
 * спрашивает его командой `bb limits show --json` (замер на этой машине:
 * 0,19 с), а не ходит к провайдерам сама. Вторая копия сбора разошлась бы с
 * индикатором при первой же правке формата, и человек читал бы на экране одни
 * цифры, а решение принималось бы по другим.
 *
 * Всё здесь fail-open: нет CLI, нет плагина лимитов, сорвался запуск — пара
 * работает как раньше. Неизвестный расход не должен молча выключать второй мозг.
 */

import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { promisify } from "node:util";

import type { СнимокЛимитов } from "./limits-balance.js";

const выполнить = promisify(execFile);

/** Свежее этого срока снимок не перезапрашиваем: расход так быстро не растёт. */
export const КЭШ_МС = 60_000;

export function разобратьСнимок(вывод: string): СнимокЛимитов | null {
  try {
    const разобрано = JSON.parse(вывод) as СнимокЛимитов;
    if (!Array.isArray(разобрано?.провайдеры)) return null;
    return разобрано;
  } catch {
    return null;
  }
}

/**
 * Чем запускать CLI.
 *
 * ⚠️ Живая проверка 14.09.2026 показала то, чего не видно ни в одном тесте: у
 * плагин-хоста в PATH НЕТ node. Файл `bb` это обычный js-скрипт с шапкой
 * `#!/usr/bin/env node`, поэтому прямой запуск падает с «env: node: No such
 * file or directory», а голое имя `bb` — с ENOENT. Отсюда порядок кандидатов:
 * сначала тот же node, на котором работает сам плагин (`process.execPath`), с
 * путём к CLI аргументом, и только потом обычные пути на случай нормального
 * окружения.
 */
export function кандидаты(
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): Array<{ файл: string; аргументы: string[] }> {
  const список: Array<{ файл: string; аргументы: string[] }> = [];
  const путьCli = typeof env.BB_CLI === "string" ? env.BB_CLI : "";
  if (путьCli.length > 0) {
    список.push({ файл: execPath, аргументы: [путьCli] });
    список.push({ файл: путьCli, аргументы: [] });
  }
  список.push({ файл: "bb", аргументы: [] });
  return список;
}

/** PATH с каталогом своего node: тогда сработает и шапка `env node`. */
function окружение(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const каталогNode = dirname(process.execPath);
  const путь = env.PATH ?? "";
  return путь.split(":").includes(каталогNode)
    ? env
    : { ...env, PATH: `${каталогNode}:${путь}` };
}

/** Результат чтения: снимок либо честная причина, почему его нет. */
export interface РезультатИсточника {
  снимок: СнимокЛимитов | null;
  причина: string | null;
}

export function создатьИсточник(опции?: {
  запуск?: (файл: string, аргументы: string[]) => Promise<{ stdout: string }>;
  часы?: () => number;
  кэшМс?: number;
}) {
  const запуск =
    опции?.запуск ??
    ((файл: string, аргументы: string[]) =>
      выполнить(файл, аргументы, {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        env: окружение(),
      }));
  const часы = опции?.часы ?? Date.now;
  const кэшМс = опции?.кэшМс ?? КЭШ_МС;

  let кэш: { итог: РезультатИсточника; когда: number } | null = null;

  return async function снимокЛимитов(): Promise<РезультатИсточника> {
    if (кэш !== null && часы() - кэш.когда < кэшМс) return кэш.итог;
    const беды: string[] = [];
    let итог: РезультатИсточника = { снимок: null, причина: "CLI bb не найден" };
    for (const { файл, аргументы } of кандидаты()) {
      try {
        const { stdout } = await запуск(файл, [
          ...аргументы,
          "limits",
          "show",
          "--json",
        ]);
        const снимок = разобратьСнимок(stdout);
        if (снимок !== null) {
          итог = { снимок, причина: null };
          break;
        }
        беды.push(`${файл}: ответ не разобран`);
      } catch (error) {
        // Причину запоминаем: молчаливый отказ выглядит как «лимиты равны»,
        // и поправка тихо перестаёт работать (ровно это и случилось при
        // первой живой проверке 14.09.2026).
        беды.push(
          `${файл}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (итог.снимок === null && беды.length > 0) {
      итог = { снимок: null, причина: беды.join("; ") };
    }
    кэш = { итог, когда: часы() };
    return итог;
  };
}
