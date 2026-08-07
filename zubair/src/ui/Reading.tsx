/* ————— شاشة القراءة —————
 *
 * ثلاث خطواتٍ ظاهرةٌ للأب، وبينها هو: **يقرأ، فيعرض، فتُجيز**.
 *
 * وأهمُّها الوسطى. فالميزة كلُّها تقوم على أن الكتاب لا يدخل دماغ ابنه بلا
 * إذنه: يرى ما فُهم بالضبط، ويشطب منه، ويرى ما يخالف ما علّمه بعينه مطفأً.
 * ولو حُذفت هذه الشاشة لصار الكتاب معلّماً ثانياً لا يُراجَع — وذاك ما لا
 * يحتمله بناءٌ كلُّه قائم على أن مصدر المعرفة محكوم.
 *
 * والرقم في أعلاها يُقال بصدق ولو كان قليلاً: «قرأتُ ٤٠٠ جملة، فهمتُ ٣١».
 */

import { useCallback, useRef, useState } from 'react';
import type { Zubair } from '../brain/brain.js';
import type { ReadFact, ReadingReport } from '../brain/core/reading.js';

type Stage = 'idle' | 'reading' | 'review' | 'saved';

export function Reading(props: { child: Zubair; onLearned: () => void }) {
  const [stage, setStage] = useState<Stage>('idle');
  const [text, setText] = useState('');
  const [report, setReport] = useState<ReadingReport | null>(null);
  const [facts, setFacts] = useState<ReadFact[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const study = useCallback((source: string) => {
    const result = props.child.study(source);
    setReport(result);
    setFacts(result.understood.map((f) => ({ ...f })));
    setStage(result.understood.length > 0 ? 'review' : 'saved');
    if (result.understood.length === 0) {
      setNote('ما فهمتُ من هذا النصّ حقيقةً واحدة. جرّب نصّاً فيه جملٌ تعريفية مثل «النمر حيوان مفترس».');
    }
  }, [props.child]);

  const onPaste = useCallback(() => {
    if (text.trim().length === 0) return;
    setNote(null);
    setWarning(null);
    study(text);
  }, [text, study]);

  const onFile = useCallback(async (chosen: File) => {
    setStage('reading');
    setNote(null);
    setWarning(null);
    try {
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      const pdf = await props.child.readFile(bytes);
      setWarning(pdf.warningAr);
      if (pdf.text.trim().length === 0) { setStage('idle'); return; }
      setText(pdf.text);
      study(pdf.text);
    } catch {
      setWarning('تعذّر فتح الملف على هذا الجهاز.');
      setStage('idle');
    }
  }, [props.child, study]);

  const toggle = useCallback((index: number) => {
    setFacts((previous) => previous.map((f, i) => (i === index ? { ...f, accepted: !f.accepted } : f)));
  }, []);

  const save = useCallback(async () => {
    const result = await props.child.absorb(facts);
    setNote(result.learned === 0
      ? 'لم تُجِز شيئاً، فلم يُحفظ شيء.'
      : `حفِظ ${result.learned} حقيقة، وزادت مفرداته ${result.words} كلمة. يقولها «بظنّي» حتى تؤكّدها بلسانك.`);
    setStage('saved');
    props.onLearned();
  }, [facts, props]);

  const reset = useCallback(() => {
    setStage('idle');
    setText('');
    setReport(null);
    setFacts([]);
    setNote(null);
    setWarning(null);
  }, []);

  const chosen = facts.filter((f) => f.accepted).length;

  return (
    <div className="panel">
      <div className="card">
        <h2>يقرأ لك</h2>
        <p>
          الصق نصّاً أو ارفع ملف PDF، فيقرأه ويعرض عليك ما فهمه. <b>ولا يحفظ حرفاً قبل أن تُجيزه.</b>
        </p>
        <p className="warn">
          وما يقرؤه لا يبلغ يقينه: يقوله «بظنّي، قريتها» حتى تؤكّده بلسانك. لأن الكتاب
          لا يسمع جوابه فيصحّحه — وأنت تسمع.
        </p>
      </div>

      {stage === 'idle' && (
        <div className="card">
          <textarea
            className="paste"
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="الصق هنا نصّاً عربياً… أنفعُه الجمل التعريفية: «النمر حيوان مفترس»، «حلب مدينة سورية»."
          />
          <div className="judge" style={{ marginTop: 10 }}>
            <button type="button" className="btn primary" onClick={onPaste} disabled={text.trim().length === 0}>
              اقرأ النصّ
            </button>
            <button type="button" className="btn" onClick={() => file.current?.click()}>
              ارفع ملف PDF
            </button>
            <input
              ref={file}
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                const chosenFile = e.target.files?.[0];
                if (chosenFile) void onFile(chosenFile);
                e.target.value = '';
              }}
            />
          </div>
          {warning && <p className="warn" style={{ marginTop: 10 }}>{warning}</p>}
        </div>
      )}

      {stage === 'reading' && <div className="card"><p>يقرأ الملف…</p></div>}

      {report && stage !== 'idle' && stage !== 'reading' && (
        <div className="card">
          <h2>ماذا فهم</h2>
          <div className="grid three">
            <div className="stat"><b>{report.sentences}</b><span>جملة قرأها</span></div>
            <div className="stat"><b>{report.understood.length}</b><span>فهمها</span></div>
            <div className="stat"><b>{report.skipped}</b><span>أهملها</span></div>
          </div>
          <p className="hint">
            نحوُه يفكّ الجملة التعريفية ولا يفكّ السرد. فالمعاجم والقوائم تُطعمه أكثر ممّا
            تُطعمه القصص — وهذا الرقم يقول لك الحقيقة كما هي.
          </p>
          {warning && <p className="warn">{warning}</p>}
        </div>
      )}

      {stage === 'review' && (
        <>
          <div className="card">
            <h2>أجِزْ ما تريده منها</h2>
            <p>اضغط على السطر لتُشعله أو تطفئه. وما يخالف ما علّمتَه يجيء مطفأً.</p>
            <ul className="reads">
              {facts.map((f, i) => (
                <li
                  key={`${f.subject}-${f.relation}-${i}`}
                  className={`${f.accepted ? 'on' : ''} ${f.state === 'مخالف' ? 'clash' : ''}`}
                >
                  <button type="button" onClick={() => toggle(i)}>
                    <b>{f.accepted ? '✓' : '○'}</b>
                    <span>
                      {f.subject} ← {f.object} <em>({f.relation})</em>
                    </span>
                    {f.state === 'مخالف' && (
                      <small className="clashNote">
                        يخالف ما يعرفه: «{f.known}» — من {f.knownFrom}
                      </small>
                    )}
                    <small>{f.sentence}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <div className="judge">
              <button type="button" className="btn primary" onClick={save}>
                احفظ {chosen} حقيقة
              </button>
              <button type="button" className="btn" onClick={reset}>إلغاء</button>
            </div>
          </div>
        </>
      )}

      {stage === 'saved' && (
        <div className="card">
          {note && <p>{note}</p>}
          <button type="button" className="btn primary" onClick={reset}>اقرأ شيئاً آخر</button>
        </div>
      )}
    </div>
  );
}
