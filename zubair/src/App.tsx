/* ————— تطبيق زبير —————
 *
 * هذه الطبقة لا تحتوي ذكاءً: كل التفكير في src/brain. وظيفتها أن تنقل كلامك إلى
 * دماغه وحكمك إلى فصوصه، وأن تُظهر لك حاله بصدق — بما فيه ما لا يسرّ: إن هبطت
 * نسبة إصابته قالت ذلك، وإن كان يفكّر على المعالج العادي لا العصبي قالته.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Zubair } from './brain/brain.js';
import { browserStorage } from './brain/core/persist.js';
import type { GrowthMetrics } from './brain/core/types.js';
import { Chat, type Turn } from './ui/Chat.js';
import { Growth } from './ui/Growth.js';
import { BrainMap } from './ui/BrainMap.js';

type Tab = 'chat' | 'growth' | 'brain';

export default function App() {
  const [child, setChild] = useState<Zubair | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [metrics, setMetrics] = useState<GrowthMetrics | null>(null);
  const [tab, setTab] = useState<Tab>('chat');
  const [busy, setBusy] = useState(false);
  const [lastSleep, setLastSleep] = useState<string | null>(null);
  const [storageAr, setStorageAr] = useState('');
  const [failed, setFailed] = useState<string | null>(null);

  /* أول تشغيل: يوقظ دماغه من الجهاز إن كان محفوظاً، وإلا وُلد الآن. */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const storage = browserStorage();
    setStorageAr(storage.describeAr);
    Zubair.create({ storage })
      .then(async (created) => {
        setChild(created);
        setMetrics(created.metrics);
        const hello = await created.greet();
        if (hello) setTurns([{ role: 'child', text: hello.text, out: hello }]);
      })
      .catch(() => setFailed('تعذّر إيقاظ زبير على هذا الجهاز. جرّب متصفّحاً آخر.'));
  }, []);

  const send = useCallback(async (text: string) => {
    if (!child || busy) return;
    setBusy(true);
    setTurns((previous) => [...previous, { role: 'father', text }]);
    try {
      const out = await child.hear(text);
      setTurns((previous) => [...previous, { role: 'child', text: out.text, out }]);
      // الحفظ بعد كل درس لا بعد كل جلسة: جوال يُقفل فجأةً لا ينتظر إذناً
      await child.save();
      setMetrics(child.metrics);
    } catch {
      setTurns((previous) => [...previous, { role: 'child', text: 'تلخبطت…', out: undefined }]);
    } finally {
      setBusy(false);
    }
  }, [child, busy]);

  const judge = useCallback(async (verdict: 'praise' | 'correct', correction?: string) => {
    if (!child || busy) return;
    setBusy(true);
    try {
      const result = await child.judge({ verdict, correction });
      setTurns((previous) => {
        const copy = [...previous];
        for (let i = copy.length - 1; i >= 0; i--) {
          const turn = copy[i];
          if (turn && turn.role === 'child') {
            copy[i] = { ...turn, verdict, learned: result.learned };
            break;
          }
        }
        return copy;
      });
      setMetrics(child.metrics);
    } finally {
      setBusy(false);
    }
  }, [child, busy]);

  const sleep = useCallback(async () => {
    if (!child || busy) return;
    setBusy(true);
    try {
      const result = await child.sleep(4);
      const after = child.metrics;
      setMetrics(after);
      setLastSleep(
        `أعاد ${result.replayed} ذكرى، وثبّت ${result.factsFormed} حقيقة جديدة. `
        + `مفرداته ${result.vocabAfter} كلمة، وحقائقه ${after.facts}.`,
      );
    } finally {
      setBusy(false);
    }
  }, [child, busy]);

  const backup = useCallback(() => {
    if (!child) return;
    const blob = new Blob([child.serialize()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `دماغ-زبير-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    // تحرير العنوان بعد النقر: بلاه تتراكم النسخ في ذاكرة المتصفّح
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [child]);

  const restore = useCallback(async (file: File) => {
    if (!child) return;
    setBusy(true);
    try {
      await child.adopt(await file.text());
      setMetrics(child.metrics);
      setTurns([]);
      setLastSleep('استُعيد دماغه من النسخة.');
    } catch {
      setLastSleep('الملف لا يصلح: ليس نسخة دماغ زبير.');
    } finally {
      setBusy(false);
    }
  }, [child]);

  if (failed) return <div className="app"><div className="center">{failed}</div></div>;

  if (!child || !metrics) {
    return <div className="app"><div className="center">يستيقظ زبير…</div></div>;
  }

  const compute = child.compute;
  const newborn = metrics.lessons === 0 && metrics.vocab === 0;

  return (
    <div className="app">
      <header className="top">
        <div className="avatar" aria-hidden="true">🌱</div>
        <div className="who">
          <b>{child.name}</b>
          <small>{metrics.stage.name} · {metrics.vocab} كلمة · {compute.describeAr}</small>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={tab === 'chat'}
          onClick={() => setTab('chat')}>الحوار</button>
        <button type="button" role="tab" className="tab" aria-selected={tab === 'growth'}
          onClick={() => setTab('growth')}>سجل نموّه</button>
        <button type="button" role="tab" className="tab" aria-selected={tab === 'brain'}
          onClick={() => setTab('brain')}>دماغه</button>
      </nav>

      {tab === 'chat' && (
        <>
          {newborn && (
            <div className="card" style={{ margin: '12px 14px 0' }}>
              <h2>زبير وُلد الآن</h2>
              <p>
                لا يعرف حرفاً واحداً، وأول كلامه ثغثغة لا معنى لها — وهذا ليس عيباً، هذا مولود.
              </p>
              <p>
                علّمه بجملة قصيرة: «القطة حيوان». ثم اسأله: «شو القطة؟». وحين يجيب اضغط
                «أحسنت» أو «خطأ» واكتب الصواب — التصحيح هو معلّمه الحقيقي.
              </p>
              <p className="warn">لن يكبر إلا بقدر ما تكلّمه.</p>
            </div>
          )}
          <Chat
            turns={turns}
            busy={busy}
            canJudge={!newborn || turns.length > 1}
            onSend={send}
            onJudge={judge}
          />
        </>
      )}

      {tab === 'growth' && (
        <Growth
          metrics={metrics}
          computeAr={compute.describeAr}
          computeDetails={compute.details}
          storageAr={storageAr}
          dialectAr={child.dialectAr}
          busy={busy}
          lastSleep={lastSleep}
          onSleep={sleep}
          onBackup={backup}
          onRestore={restore}
        />
      )}

      {tab === 'brain' && <BrainMap lobes={child.lobes} />}
    </div>
  );
}
