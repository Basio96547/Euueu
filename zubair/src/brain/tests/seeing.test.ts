/* ————— أن يتعلّم بعينه: اختبار الدماغ كاملاً لا فصّاً منه —————
 *
 * ما سبق أثبت أن القشور تعمل. وهذا يُثبت ما هو أهمّ: أن تُريه شيئاً وتقول «هذه
 * تفاحة» فيعرفها بعدها إذا سألته «شو هذا؟» — أي أن الحاسّتين موصولتان فعلاً عبر
 * دورة النبضة، لا أن كل فص يعمل وحده.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Zubair } from '../brain.js';
import { memoryStorage } from '../core/persist.js';
import type { RawFrame } from '../core/senses.js';

/* ————— مشاهد: الأب يوجّه الكاميرا إلى شيء ————— */

type Rgb = [number, number, number];

function scene(
  draw: (paint: (x: number, y: number, c: Rgb) => void) => void,
  size = 96,
  background: Rgb = [22, 22, 26],
): RawFrame {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = background[0];
    rgba[i + 1] = background[1];
    rgba[i + 2] = background[2];
    rgba[i + 3] = 255;
  }
  const paint = (x: number, y: number, c: Rgb): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (Math.floor(y) * size + Math.floor(x)) * 4;
    rgba[i] = c[0];
    rgba[i + 1] = c[1];
    rgba[i + 2] = c[2];
  };
  draw(paint);
  return { width: size, height: size, rgba };
}

const apple = (cx = 48, cy = 48): RawFrame => scene((paint) => {
  for (let y = cy - 24; y <= cy + 24; y++) {
    for (let x = cx - 24; x <= cx + 24; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= 576) paint(x, y, [235, 60, 50]);
    }
  }
});

const book = (cx = 48, cy = 48): RawFrame => scene((paint) => {
  for (let y = cy - 22; y <= cy + 22; y++) {
    for (let x = cx - 22; x <= cx + 22; x++) paint(x, y, [60, 110, 235]);
  }
});

/** كفٌّ على الكاميرا: أقتم من خلفية المشهد بكثير. */
const darkness = (): RawFrame => scene(() => {}, 96, [3, 3, 4]);

async function newborn(seed = 0xc0ffee & 0xffff) {
  return Zubair.create({ storage: memoryStorage(), seed, fresh: true });
}

/* ————— الحواسّ تصل ————— */

test('يرى ويسمع ويحسّ، ويعرف أنه لا يعرف ما يراه', async () => {
  const zubair = await newborn();
  const seen = zubair.see(apple());
  assert.ok(seen.salience > 0, `المنظر بارز (${seen.salience.toFixed(2)})`);
  assert.equal(seen.dark, false);
  assert.equal(seen.recognized, null, 'وليدٌ لم يُعلَّم لا يسمّي ما يراه');

  const heard = zubair.listen({ sampleRate: 16000, samples: tone(160) });
  assert.equal(heard.kind, 'صوت بشري', 'يعرف أن هذا صوت بشري');
  assert.ok(heard.pitchHz !== null);

  const felt = zubair.feel({ x: 0.5, y: 0.5, force: 0.3, durationMs: 90 }, null);
  assert.equal(felt.kind, 'نقرة');
  assert.ok(felt.valence > 0, 'واللمس اللطيف خير عنده');

  assert.equal(zubair.see(darkness()).dark, true, 'ويعرف كفّاً على الكاميرا');
});

test('الهزّ أذى يُوسَم فوراً بلا أن يُكلَّم', async () => {
  const zubair = await newborn();
  let last = 0;
  for (let i = 0; i < 10; i++) {
    const sign = i % 2 === 0 ? 1 : -1;
    last = zubair.feel(null, { accel: [20 * sign, 16 * sign, 9.81], lux: 300 }).valence;
  }
  assert.ok(last < -0.2, `الهزّ العنيف سالب (${last.toFixed(2)})`);
});

/* ————— التسمية: أهمّ اختبار في هذه المرحلة ————— */

test('تُريه شيئاً وتسمّيه له مرة، فيعرفه بعينه', async () => {
  const zubair = await newborn();

  // الأب يوجّه الكاميرا إلى تفاحة ويقول «هذه تفاحة»
  zubair.see(apple());
  await zubair.hear('هذه تفاحة');
  assert.equal(zubair.metrics.objectsSeen, 1, 'ربط الشكل بالاسم');

  // ثم يسأله وهو يرى التفاحة نفسها
  zubair.see(apple(50, 46));
  const answer = await zubair.hear('شو هذا؟');
  assert.ok(answer.text.includes('تفاحة'),
    `أجاب من عينه لا من ذاكرة نصّية: «${answer.text}»`);
});

test('يفرّق شيئين علّمته إياهما بالكاميرا', async () => {
  const zubair = await newborn(0x51ff);
  zubair.see(apple());
  await zubair.hear('هذه تفاحة');
  zubair.see(book());
  await zubair.hear('هذا كتاب');
  assert.equal(zubair.metrics.objectsSeen, 2);

  zubair.see(apple(44, 52));
  const first = await zubair.hear('شو هذا؟');
  zubair.see(book(52, 44));
  const second = await zubair.hear('شو هذا؟');

  assert.ok(first.text.includes('تفاحة'), `التفاحة: «${first.text}»`);
  assert.ok(second.text.includes('كتاب'), `والكتاب: «${second.text}»`);
});

test('لا يسمّي ما لم يُعلَّم، ولا يخترع اسماً لشيء غريب', async () => {
  const zubair = await newborn(0x77ac);
  zubair.see(apple());
  await zubair.hear('هذه تفاحة');

  // منظر لم يره قط: إمّا يُقرّ بجهله أو يسأل — لا يسمّيه بما عنده
  zubair.see(scene((paint) => {
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if ((x + y) % 9 < 3) paint(x, y, [240, 240, 120]);
  }));
  const out = await zubair.hear('شو هذا؟');
  assert.ok(!out.text.includes('تفاحة'),
    `لا يسمّي الغريب بما يعرف: «${out.text}»`);
});

test('تصحيحك يُعدّل ما يراه لا ما يحفظه فقط', async () => {
  const zubair = await newborn(0x2b5e);
  const lemon = (cx = 48, cy = 48): RawFrame => scene((paint) => {
    for (let y = cy - 17; y <= cy + 17; y++) {
      for (let x = cx - 17; x <= cx + 17; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= 289) paint(x, y, [240, 230, 70]);
      }
    }
  });

  // سمّاها أبوه خطأً «تفاحة» ثم صحّح إلى «ليمونة» أربع مرات
  zubair.see(lemon());
  await zubair.hear('هذه تفاحة');
  for (let round = 0; round < 4; round++) {
    zubair.see(lemon(48 + round, 48));
    const guess = await zubair.hear('شو هذا؟');
    if (guess.text.includes('تفاحة')) {
      const judged = await zubair.judge({ verdict: 'correct', correction: 'ليمونة' });
      assert.ok(judged.learned.some((line) => line.includes('بعينه')),
        `يُخبر أباه أنه تعلّم بعينه: ${judged.learned.join(' | ')}`);
    } else {
      // سمّاها صحيحاً أو أقرّ بجهله: نُعلّمه الصواب مباشرةً كما يفعل الأب
      zubair.see(lemon(48 + round, 48));
      await zubair.hear('هذه ليمونة');
    }
  }

  zubair.see(lemon(50, 47));
  const finalAnswer = await zubair.hear('شو هذا؟');
  assert.ok(!finalAnswer.text.includes('تفاحة'),
    `لم يعد يسمّيها تفاحة: «${finalAnswer.text}»`);
});

test('لا يستعمل منظراً قديماً: ما رُفع عن الكاميرا ليس «الآن»', async () => {
  const zubair = await newborn(0x9911);
  const at = 1_000_000;
  zubair.see(apple(), at);
  await zubair.hear('هذه تفاحة', at + 100);

  // بعد دقيقة كاملة: المنظر ليس حاضراً وإن كان محفوظاً
  zubair.see(apple(), at + 1000);
  const stale = await zubair.hear('شو هذا؟', at + 61_000);
  assert.ok(!stale.text.includes('تفاحة'),
    `لا يسمّي ما لم يعد يراه: «${stale.text}»`);
});

test('المهاد يُغلق الحواسّ حين تهبط يقظته', async () => {
  const zubair = await newborn(0x4a4a);
  // جلسة طويلة تُنزل يقظته، ثم منظر ضعيف البروز
  for (let i = 0; i < 40; i++) await zubair.hear('كلام عادي');
  zubair.see(scene((paint) => paint(48, 48, [40, 40, 45])));
  const out = await zubair.hear('شو هذا؟');
  const relayStep = out.trace.find((step) => step.lobe === 'thalamus' && step.note.includes('انتباه') === false);
  assert.ok(relayStep !== undefined, 'أثر النبضة يذكر ما فعله المهاد بحواسّه');
  assert.ok(/[؀-ۿ]/.test(relayStep?.note ?? ''), 'بالعربية كي يقرأه الأب');
});

test('ما يعرفه بعينه لا يُنسى بعد إغلاق التطبيق', async () => {
  const storage = memoryStorage();
  const first = await Zubair.create({ storage, seed: 0x1a2b, fresh: true });
  first.see(apple());
  await first.hear('هذه تفاحة');
  await first.save();
  assert.equal(first.metrics.objectsSeen, 1);

  const second = await Zubair.create({ storage, seed: 0x1a2b });
  assert.equal(second.metrics.objectsSeen, 1, 'ذاكرة الأشياء انتقلت');
  second.see(apple(46, 50));
  const answer = await second.hear('شو هذا؟');
  assert.ok(answer.text.includes('تفاحة'), `ويعرفها في الجلسة الجديدة: «${answer.text}»`);
});

test('الحواسّ لا تُسقط الدماغ بمدخلات شاذّة', async () => {
  const zubair = await newborn(0x3c3c);
  const junk: RawFrame[] = [
    { width: 0, height: 0, rgba: new Uint8ClampedArray(0) },
    { width: 4, height: 4, rgba: new Uint8ClampedArray(4) },
    { width: -5, height: 10, rgba: new Uint8ClampedArray(16) },
  ];
  for (const frame of junk) {
    assert.doesNotThrow(() => zubair.see(frame), 'إطار عطب لا يرمي');
  }
  assert.doesNotThrow(() => zubair.listen({ sampleRate: 0, samples: new Float32Array(0) }));
  assert.doesNotThrow(() => zubair.listen({ sampleRate: 16000, samples: new Float32Array([NaN, Infinity, -Infinity]) }));
  assert.doesNotThrow(() => zubair.feel({ x: NaN, y: 5, force: -3, durationMs: NaN }, { accel: [NaN, 1e9, -1e9], lux: -50 }));

  const out = await zubair.hear('شو هذا؟');
  assert.ok(out.text.trim().length > 0, 'ويبقى قادراً على الكلام');
  assert.ok(Number.isFinite(out.confidence));
});

test('خريطة دماغه صارت ثمانية عشر فصاً', async () => {
  const zubair = await newborn();
  const lobes = zubair.lobes;
  assert.ok(lobes.length >= 18, `الفصوص الحسّية أُضيفت (${lobes.length})`);
  const names = lobes.map((l) => l.name);
  for (const expected of ['visualCortex', 'auditoryCortex', 'somatosensory', 'inferotemporal']) {
    assert.ok(names.includes(expected), `${expected} في الخريطة`);
  }
  assert.equal(new Set(names).size, names.length, 'ولا فص مكرّر');
});

/* ————— نغمة للاختبار ————— */
function tone(hz: number, sampleRate = 16000, ms = 128): Float32Array {
  const n = Math.floor((sampleRate * ms) / 1000);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    samples[i] = 0.5 * (Math.sin(2 * Math.PI * hz * t)
      + 0.5 * Math.sin(4 * Math.PI * hz * t)
      + 0.25 * Math.sin(6 * Math.PI * hz * t)) / 1.75;
  }
  return samples;
}
