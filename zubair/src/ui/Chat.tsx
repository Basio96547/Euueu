/* ————— المحادثة: هنا يجري التعليم فعلاً —————
 *
 * الأهم في هذه الشاشة ليس فقاعات الكلام بل زرّا الحكم تحت كل جواب. كلمة «خطأ»
 * وحدها تُضعف اختياره، أما التصحيح المكتوب فيصير درساً كاملاً يُفهم ويُحفظ
 * ويُعاد في نومه. لذلك زر الخطأ يفتح حقل الصواب ولا يكتفي بالرفض.
 */

import { useEffect, useRef, useState } from 'react';
import type { TickOutput, TraceStep } from '../brain/core/types.js';

export interface Turn {
  role: 'father' | 'child';
  text: string;
  out?: TickOutput;
  verdict?: 'praise' | 'correct';
  learned?: readonly string[];
}

const KIND_AR: Record<TickOutput['kind'], string> = {
  answer: 'جواب',
  question: 'سؤال',
  admission: 'إقرار بجهل',
  acknowledge: 'إقرار بالتلقّي',
  greeting: 'تحية',
  babble: 'ثغثغة',
};

const UNIT_AR: Record<TraceStep['where'], string> = {
  npu: 'المعالج العصبي',
  gpu: 'الرسوميات',
  cpu: 'المعالج',
  none: '—',
};

export function Chat(props: {
  turns: readonly Turn[];
  busy: boolean;
  canJudge: boolean;
  onSend: (text: string) => void;
  onJudge: (verdict: 'praise' | 'correct', correction?: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [fixing, setFixing] = useState(false);
  const [correction, setCorrection] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  // النزول إلى آخر الحوار مع كل جواب: أب يبحث عن كلام ابنه بالتمرير أب مُتعَب
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [props.turns.length, props.busy]);

  const send = (): void => {
    const text = draft.trim();
    if (text.length === 0 || props.busy) return;
    setDraft('');
    setFixing(false);
    setCorrection('');
    props.onSend(text);
  };

  const lastIndex = props.turns.length - 1;

  return (
    <>
      <div className="stream">
        {props.turns.length === 0 && (
          <div className="center">
            علّم زبير أول كلمة. جرّب: «القطة حيوان»
          </div>
        )}

        {props.turns.map((turn, index) => (
          <div key={index} className={`turn ${turn.role}`}>
            <div className={`bubble ${turn.out?.kind ?? ''}`}>{turn.text}</div>

            {turn.out && (
              <div className="meta">
                <span>{KIND_AR[turn.out.kind]}</span>
                <span>ثقته {Math.round(turn.out.confidence * 100)}٪</span>
                {turn.out.trace.length > 0 && <TraceView steps={turn.out.trace} />}
              </div>
            )}

            {turn.verdict && (
              <div className={`judged ${turn.verdict === 'correct' ? 'wrong' : ''}`}>
                {turn.verdict === 'praise' ? 'مدحته' : 'صحّحت له'}
                {turn.learned && turn.learned.length > 0 && ` — ${turn.learned.join('، ')}`}
              </div>
            )}

            {turn.role === 'child' && index === lastIndex && props.canJudge && !turn.verdict && (
              <>
                <div className="judge">
                  <button type="button" className="btn good" disabled={props.busy}
                    onClick={() => props.onJudge('praise')}>أحسنت</button>
                  <button type="button" className="btn bad" disabled={props.busy}
                    onClick={() => setFixing((value) => !value)}>خطأ</button>
                </div>

                {fixing && (
                  <div className="fix">
                    <input
                      type="text"
                      value={correction}
                      placeholder="اكتب الجواب الصحيح"
                      onChange={(event) => setCorrection(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          props.onJudge('correct', correction.trim() || undefined);
                          setFixing(false);
                          setCorrection('');
                        }
                      }}
                    />
                    <button type="button" className="btn primary" disabled={props.busy}
                      onClick={() => {
                        props.onJudge('correct', correction.trim() || undefined);
                        setFixing(false);
                        setCorrection('');
                      }}>علّمه</button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        {props.busy && <div className="turn child"><div className="bubble">…</div></div>}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <input
          type="text"
          value={draft}
          placeholder="كلّم زبير"
          enterKeyHint="send"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') send(); }}
        />
        <button type="button" className="btn primary" onClick={send} disabled={props.busy}>قل</button>
      </div>
    </>
  );
}

/** أثر النبضة: أي فص عمل، وماذا فعل، وأين نُفِّذ حسابه.
 *  هذا ما يجعل الأب يفهم دماغ ابنه بدل أن يراه صندوقاً مغلقاً. */
function TraceView(props: { steps: readonly TraceStep[] }) {
  return (
    <details className="trace">
      <summary>ما جرى في دماغه</summary>
      <ul className="steps">
        {props.steps.map((step, index) => (
          <li key={index}>
            <b>{step.ar}</b>
            <span>{step.note}</span>
            <em>{UNIT_AR[step.where]}{step.ms > 0 ? ` · ${step.ms}مث` : ''}</em>
          </li>
        ))}
      </ul>
    </details>
  );
}
