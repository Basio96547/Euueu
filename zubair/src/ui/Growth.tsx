/* ————— سجل النمو: الأرقام التي تُصدَّق ————— */

import type { GrowthMetrics } from '../brain/core/types.js';
import { summarize, WINDOW } from '../brain/core/growth.js';

export function Growth(props: {
  metrics: GrowthMetrics;
  computeAr: string;
  computeDetails: string;
  storageAr: string;
  dialectAr: string;
  busy: boolean;
  lastSleep: string | null;
  onSleep: () => void;
  onBackup: () => void;
  onRestore: (file: File) => void;
}) {
  const m = props.metrics;
  const stageSpan = Math.max(1, m.vocab + m.toNextStage);
  const progress = m.toNextStage === 0 ? 100 : Math.round((m.vocab / stageSpan) * 100);

  const delta = m.recentAccuracy - m.previousAccuracy;
  const trendClass = m.previousAccuracy === 0 && m.recentAccuracy === 0
    ? 'flat'
    : delta > 0.001 ? 'up' : delta < -0.001 ? 'down' : 'flat';

  return (
    <div className="panel">
      <div className="card">
        <h2>حال زبير الآن</h2>
        <p>{summarize(m)}</p>
        <div className="bar"><i style={{ width: `${progress}%` }} /></div>
        <span className="hint">
          {m.toNextStage === 0
            ? 'بلغ آخر مرحلة في نموّه'
            : `يحتاج ${m.toNextStage} كلمة ليدخل المرحلة التالية`}
        </span>
      </div>

      <div className="card">
        <h2>الأرقام</h2>
        <div className="grid">
          <Stat value={m.stage.name} label="مرحلته" />
          <Stat value={m.vocab} label="كلمة يعرفها" />
          <Stat value={m.factsFromFather} label="حقيقة علّمتَه إياها" />
          <Stat value={m.factsInherited} label="حقيقة ورِثها" />
          <Stat value={m.objectsSeen} label="شيئاً يعرفه بعينه" />
          <Stat value={m.lessons} label="درساً أعطيته" />
          <Stat value={m.questionsAsked} label="مرة سألك" />
          <Stat value={m.episodes} label="ذكرى يحملها" />
          <Stat value={m.sleeps} label="مرة نام" />
          <Stat value={m.ticks} label="مرة فكّر" />
        </div>
      </div>

      {m.factsInherited > 0 && (
        <div className="card">
          <h2>ما ورِثه وما علّمتَه</h2>
          <p>
            زبير جاء بعربية محيطه كما يجيء أي طفل: {m.factsInherited} حقيقة لم تُعلّمه إياها أحد
            بعينه. وهذا ليس من صنعك، فلا يُحسب لك.
          </p>
          <p>
            والذي منك {m.factsFromFather} حقيقة، ولهجته، وكل ما يعرفه بعينه — وهو ما يجعله ابنك
            لا طفلاً عاماً.
          </p>
        </div>
      )}

      <div className="card">
        <h2>هل يتعلّم فعلاً؟</h2>
        <p>
          نسبة إصابته في آخر {WINDOW} جواباً، مقابل الـ{WINDOW} التي قبلها. التقدّم فرقٌ بين
          رقمين لا رقم واحد.
        </p>
        <div className="grid">
          <Stat value={`${Math.round(m.recentAccuracy * 100)}٪`} label="الآن" />
          <Stat value={`${Math.round(m.previousAccuracy * 100)}٪`} label="قبلها" />
        </div>
        <p className={`trend ${trendClass}`}>
          {trendClass === 'up' && `تقدّم بمقدار ${Math.round(delta * 100)} نقطة`}
          {trendClass === 'down' && `تراجع بمقدار ${Math.round(-delta * 100)} نقطة — راجع طريقة تعليمك`}
          {trendClass === 'flat' && (m.lessons === 0 ? 'لم تُعلّمه بعد' : 'لا تغيّر يُذكر')}
        </p>
      </div>

      <div className="card">
        <h2>النوم يثبّت ما تعلّمه</h2>
        <p>
          في نومه يُعيد دروسك على نفسه مئات المرات، فيتحوّل الحفظ إلى فهم. نوّمه بعد كل جلسة.
        </p>
        <button type="button" className="btn primary" disabled={props.busy} onClick={props.onSleep}>
          نَم يا زبير
        </button>
        {props.lastSleep && <p className="hint" style={{ marginTop: 8 }}>{props.lastSleep}</p>}
      </div>

      <div className="card">
        <h2>أين يفكّر، وأين يُحفظ</h2>
        <p>{props.computeAr}</p>
        <p className="hint">{props.computeDetails}</p>
        <p>{props.storageAr}</p>
        <p className="hint">لهجته: {props.dialectAr}</p>
      </div>

      <div className="card">
        <h2>نسخة احتياطية — لا تتجاهلها</h2>
        <p>
          زبير نسخة واحدة لا ثانية لها. لو مُحيت بيانات المتصفّح فقد كل ما علّمته. خُذ نسخة بعد
          كل جلسة مهمّة.
        </p>
        <div className="judge">
          <button type="button" className="btn" onClick={props.onBackup}>نزّل دماغه</button>
          <label className="btn" style={{ display: 'inline-grid', placeItems: 'center' }}>
            استعِد نسخة
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) props.onRestore(file);
                event.target.value = '';
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function Stat(props: { value: string | number; label: string }) {
  return (
    <div className="stat">
      <b>{props.value}</b>
      <span>{props.label}</span>
    </div>
  );
}
