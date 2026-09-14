// Сухой прогон второго мозга по ЖИВОЙ базе bb: только чтение, ничего не
// запускается. Показывает, что случилось бы, будь плагин включён на все треды.
//
// Заведён 07.09.2026 по требованию Артёма: «чтобы здесь не заигрываться, чтобы
// не получалось чрезмерной работы ради работы». Прежде чем включать второй
// мозг на двести тредов, надо увидеть числа, а не поверить замыслу.
//
// Запуск: node --experimental-strip-types _check/dry-run.mjs
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

import { classifyTask, сВзглядомНаЛимиты } from "../classify.ts";
// Ту же функцию, что работает в плагине: иначе измеритель разойдётся с
// измеряемым и покажет не то, что случится на самом деле.
import { значимыйЗапрос, нашеСообщение } from "../human-turns.ts";
import { балансЛимитов } from "../limits-balance.ts";
import { создатьИсточник } from "../limits-source.ts";

const бд = new DatabaseSync(join(homedir(), ".bb", "bb.db"), { readOnly: true });

const треды = бд
  .prepare(
    `select id, provider_id, status, coalesce(title, title_fallback, '') as имя
       from threads
      where parent_thread_id is null
        and visibility = 'visible'
        and deleted_at is null
        and archived_at is null
      order by updated_at desc`,
  )
  .all();

const запросы = бд.prepare(
  `select data from events
    where thread_id = ? and type = 'client/turn/requested'
    order by sequence desc limit 40`,
);

/** Запросы ЧЕЛОВЕКА: не spawn от другого треда и не системное. */
function запросыЧеловекаИзБазы(threadId) {
  const найденные = [];
  for (const строка of запросы.all(threadId)) {
    let j;
    try {
      j = JSON.parse(строка.data);
    } catch {
      continue;
    }
    if (j.initiator !== "user") continue;
    if (j.source !== "tell") continue;
    if (j.senderThreadId != null) continue;
    const текст = (j.input ?? [])
      .filter((ч) => ч?.type === "text")
      .map((ч) => ч.text ?? "")
      .join("\n")
      .trim();
    // Сообщения самого плагина и автоматизаций по служебным полям от
    // человеческих неотличимы, и живой плагин отсеивает их маркером. Здесь
    // этого отсева не было, поэтому измеритель считал работой человека свои же
    // сводки, советы о расходе и запуски по расписанию (найдено 14.09.2026:
    // в примерах прогона стояли «**Расход ·» и «[bb automation»).
    if (текст.length > 0 && !нашеСообщение(текст)) найденные.push(текст);
  }
  // Запросы шли от свежих к старым: возвращаем в порядке разговора.
  return найденные.reverse();
}

// Живой расход лимитов: прогон показывает, что случится СЕГОДНЯ, а не в
// безвоздушном пространстве. Нет плагина лимитов — поправки просто нет.
const источник = создатьИсточник();
const { снимок, причина } = await источник();

const поКлассам = new Map();
let сзапросом = 0;
let проверок = 0;
let понижено = 0;
let отложено = 0;
const примеры = [];

for (const т of треды) {
  const задача = значимыйЗапрос(запросыЧеловекаИзБазы(т.id));
  if (задача === undefined) continue;
  сзапросом += 1;
  const первичное = classifyTask({
    prompt: задача,
    title: т.имя,
    parentProvider: т.provider_id ?? "",
  });
  const баланс = балансЛимитов({
    снимок,
    провайдерАвтора: т.provider_id ?? "",
    провайдерПроверяющего: первичное.provider ?? "",
  });
  const решение = сВзглядомНаЛимиты(первичное, баланс);
  if (первичное.pair && !решение.pair) отложено += 1;
  if (решение.pair && первичное.model !== решение.model) понижено += 1;
  const ключ = `${решение.pair ? "ПРОВЕРКА" : "молчим  "} ${решение.taskClass}`;
  поКлассам.set(ключ, (поКлассам.get(ключ) ?? 0) + 1);
  if (решение.pair) {
    проверок += 1;
    if (примеры.length < 10) {
      примеры.push(
        `   ${решение.taskClass} · ${решение.reasoningLevel} · раундов ${решение.maxRounds}\n      «${задача.slice(0, 88).replace(/\s+/g, " ")}»`,
      );
    }
  }
}

console.log(`Видимых корневых тредов: ${треды.length}`);
console.log(`Из них с запросом человека: ${сзапросом}`);
console.log(`Второй мозг подключился бы: ${проверок}`);
console.log(`Промолчал бы: ${сзапросом - проверок}`);
console.log(
  снимок === null
    ? `Поправки на лимиты нет: ${причина ?? "снимок недоступен"}\n`
    : `Паритет лимитов: ступень понижена у ${понижено}, отложено по перекосу ${отложено}\n`,
);
console.log("По классам:");
for (const [ключ, сколько] of [...поКлассам.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${ключ}: ${сколько}`);
}
console.log("\nПримеры задач, где второй мозг подключился бы:");
for (const п of примеры) console.log(п);
