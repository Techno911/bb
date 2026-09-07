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

import { classifyTask } from "../classify.ts";

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

/** Последний запрос ЧЕЛОВЕКА: не spawn от другого треда и не системное. */
function последнийЗапросЧеловека(threadId) {
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
    if (текст.length > 0) return текст;
  }
  return null;
}

const поКлассам = new Map();
let сзапросом = 0;
let проверок = 0;
const примеры = [];

for (const т of треды) {
  const задача = последнийЗапросЧеловека(т.id);
  if (задача === null) continue;
  сзапросом += 1;
  const решение = classifyTask({
    prompt: задача,
    title: т.имя,
    parentProvider: т.provider_id ?? "",
  });
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
console.log(`Промолчал бы: ${сзапросом - проверок}\n`);
console.log("По классам:");
for (const [ключ, сколько] of [...поКлассам.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${ключ}: ${сколько}`);
}
console.log("\nПримеры задач, где второй мозг подключился бы:");
for (const п of примеры) console.log(п);
