// Куда уходят токены: замер по живой базе bb, только чтение.
//
// Заведён 07.09.2026, когда Артём сказал «где-то нерационально использую выбор
// моделей». Замер показал, что дело не в выборе модели треда: 1M-окно
// оправдано (медиана пика контекста 385 тыс., 59 тредов из 69 перевалили за
// 200 тыс.), а чисто механических ходов у Opus всего десятая часть. Дорого
// стоит другое — длинная механическая серия ВНУТРИ одного хода: каждый
// следующий вызов перечитывает разросшийся контекст.
//
// Запуск: node --experimental-strip-types _check/cost-report.mjs
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const бд = new DatabaseSync(join(homedir(), ".bb", "bb.db"), { readOnly: true });
const млн = (n) => `${(n / 1e6).toFixed(1)} млн`;

const модель = new Map();
const ходов = new Map();
for (const с of бд
  .prepare("select thread_id, data from events where type='client/turn/requested' order by created_at")
  .all()) {
  let j;
  try {
    j = JSON.parse(с.data);
  } catch {
    continue;
  }
  const m = j.execution?.model;
  if (!m) continue;
  if (!модель.has(с.thread_id)) модель.set(с.thread_id, m);
  ходов.set(с.thread_id, (ходов.get(с.thread_id) ?? 0) + 1);
}

const токены = new Map();
for (const с of бд
  .prepare("select thread_id, data from events where type='thread/tokenUsage/updated'")
  .all()) {
  let t;
  try {
    t = JSON.parse(с.data).tokenUsage?.total?.totalTokens;
  } catch {
    continue;
  }
  if (t && t > (токены.get(с.thread_id) ?? 0)) токены.set(с.thread_id, t);
}

const имена = new Map(
  бд.prepare("select id, coalesce(title, title_fallback, '') as имя from threads").all().map((р) => [р.id, р.имя]),
);

const поМоделям = new Map();
for (const [tid, t] of токены) {
  const m = модель.get(tid) ?? "(неизвестно)";
  const было = поМоделям.get(m) ?? { токены: 0, тредов: 0, ходов: 0 };
  было.токены += t;
  было.тредов += 1;
  было.ходов += ходов.get(tid) ?? 0;
  поМоделям.set(m, было);
}
const всего = [...поМоделям.values()].reduce((с, v) => с + v.токены, 0);

console.log(`Всего израсходовано: ${млн(всего)} токенов\n`);
console.log("По моделям:");
for (const [m, v] of [...поМоделям].sort((a, b) => b[1].токены - a[1].токены)) {
  const наХод = v.ходов > 0 ? v.токены / v.ходов : 0;
  console.log(
    `  ${m.padEnd(24)} ${млн(v.токены).padStart(10)}  ${((100 * v.токены) / всего).toFixed(1).padStart(5)}%` +
      `   тредов ${String(v.тредов).padStart(3)}   на ход ${млн(наХод)}`,
  );
}

console.log("\nСамые дорогие треды (где искать экономию):");
for (const [tid, t] of [...токены].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  const н = ходов.get(tid) ?? 0;
  const наХод = н > 0 ? t / н : t;
  console.log(
    `  ${млн(t).padStart(9)}  ходов ${String(н).padStart(3)}  на ход ${млн(наХод).padStart(9)}  ${имена.get(tid) ?? ""}`,
  );
}

console.log(
  "\nЦена одного хода это главный показатель: она растёт от накопленного" +
    "\nконтекста, а не от имени модели. Ход дороже 10 млн почти всегда значит" +
    "\nдлинную механическую серию, которой место в дочернем треде.",
);
