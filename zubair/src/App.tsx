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
import type { Feelings } from './brain/lobes/emotion.js';
import { Chat, type Turn } from './ui/Chat.js';
import { Growth } from './ui/Growth.js';
import { BrainMap } from './ui/BrainMap.js';

type Tab = 'chat' | 'growth' | 'brain';

export default function App() {
  const [child, setChild] = useState<Zubair | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [metrics, setMetrics] = useState<GrowthMetrics | null>(null);
  /* مشاعره حالةٌ منفصلة عن أرقامه لأنها تتغيّر بلا أن يتغيّر رقمٌ واحد: مدحةٌ
   * لا تزيد مفرداته ولا حقائقه، وتقلب شعوره كلَّه. */
  const [mood, setMood] = useState<{ now: Feelings; list: Zubair['moodList'] } | null>(null);
  const [tab, setTab] = useState<Tab>('chat');
  const [busy, setBusy] = useState(false);
  const [lastSleep, setLastSleep] = useState<string | null>(null);
  const [storageAr, setStorageAr] = useState('');
  const [failed, setFailed] = useState<string | null>(null);

  /** لقطةٌ واحدة لحاله كلِّه بعد كل حدث: أرقامه ومشاعره معاً فلا يفترقان. */
  const refresh = useCallback((who: Zubair) => {
    setMetrics(who.metrics);
    setMood({ now: who.mood, list: who.moodList });
  }, []);

  /* أول تشغيل: يوقظ دماغه من الجهاز إن كان محفوظاً، وإلا وُلد الآن. */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const storage = browserStorage();
    setStorageAr(storage.describeAr);
    Zubair.create({ storage, heritage: true })
      .then(async (created) => {
        setChild(created);
        refresh(created);
        const hello = await created.greet();
        if (hello) setTurns([{ role: 'child', text: hello.text, out: hello }]);
      })
      .catch(() => setFailed('تعذّر إيقاظ زبير على هذا الجهاز. جرّب متصفّحاً آخر.'));
  }, [refresh]);

  const send = useCallback(async (text: string) => {
    if (!child || busy) return;
    setBusy(true);
    setTurns((previous) => [...previous, { role: 'father', text }]);
    try {
      const out = await child.hear(text);
      setTurns((previous) => [...previous, { role: 'child', text: out.text, out }]);
      // الحفظ بعد كل درس لا بعد كل جلسة: جوال يُقفل فجأةً لا ينتظر إذناً
      await child.save();
      refresh(child);
    } catch {
      setTurns((previous) => [...previous, { role: 'child', text: 'تلخبطت…', out: undefined }]);
    } finally {
      setBusy(false);
    }
  }, [child, busy, refresh]);

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
      refresh(child);
    } finally {
      setBusy(false);
    }
  }, [child, busy, refresh]);

  const sleep = useCallback(async () => {
    if (!child || busy) return;
    setBusy(true);
    try {
      const result = await child.sleep(4);
      const after = child.metrics;
      refresh(child);
      setLastSleep(
        `أعاد ${result.replayed} ذكرى، وثبّت ${result.factsFormed} حقيقة جديدة. `
        + `مفرداته ${result.vocabAfter} كلمة، وحقائقه ${after.facts}.`,
      );
    } finally {
      setBusy(false);
    }
  }, [child, busy, refresh]);

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
      refresh(child);
      setTurns([]);
      setLastSleep('استُعيد دماغه من النسخة.');
    } catch {
      setLastSleep('الملف لا يصلح: ليس نسخة دماغ زبير.');
    } finally {
      setBusy(false);
    }
  }, [child, refresh]);

  if (failed) return <div className="app"><div className="center">{failed}</div></div>;

  if (!child || !metrics || !mood) {
    return <div className="app"><div className="center">يستيقظ زبير…</div></div>;
  }

  const compute = child.compute;
  const firstSession = metrics.lessons === 0;

  return (
    <div className="app">
      <header className="top">
        <div className="avatar" aria-hidden="true">🌱</div>
        <div className="who">
          <b>{child.name}</b>
          <small>{metrics.vocab} كلمة · {metrics.facts} حقيقة · {compute.describeAr}</small>
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
          {firstSession && (
            <div className="card" style={{ margin: '12px 14px 0' }}>
              <h2>هذه أول جلسة معه</h2>
              <p>
                زبير يجيء بعربيةٍ عامّة: <b>{metrics.vocab} كلمة</b> و<b>{metrics.factsInherited} حقيقة</b> لم
                تُعلّمه إياها، ومنطقةِ نحوٍ مكتوبةٍ بقواعد العربية. هذا ليس من صنعك ولا يُحسب لك.
              </p>
              <p>
                والذي منك وحدك: كل ما يخصّ عالمك — أسماء أهلك، وما تحبّه، ولهجتك، وتصحيحك.
                وسجل نموّه يفصل بين الاثنين رقماً برقم.
              </p>
              <p>
                علّمه: «القطة حيوان». ثم اسأله: «شو القطة؟» أو «كيف القطة؟». وحين يجيب اضغط
                «أحسنت» أو «خطأ» واكتب الصواب — التصحيح هو معلّمه الحقيقي.
              </p>
              <p className="warn">ولن يعرف عن عالمك أنت شيئاً إلا بقدر ما تكلّمه.</p>
            </div>
          )}
          <Chat
            turns={turns}
            busy={busy}
            canJudge={!firstSession || turns.length > 1}
            onSend={send}
            onJudge={judge}
          />
        </>
      )}

      {tab === 'growth' && (
        <Growth
          metrics={metrics}
          mood={mood.now}
          moodList={mood.list}
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
