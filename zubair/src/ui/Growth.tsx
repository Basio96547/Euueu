/* ————— سجل النمو: الأرقام التي تُصدَّق ————— */

import type { GrowthMetrics } from '../brain/core/types.js';
import type { Feelings } from '../brain/lobes/emotion.js';
import { summarize, WINDOW } from '../brain/core/growth.js';

export function Growth(props: {
  metrics: GrowthMetrics;
  mood: Feelings;
  moodList: ReadonlyArray<{ name: string; value: number; complex: boolean }>;
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
  const delta = m.recentAccuracy - m.previousAccuracy;
  const trendClass = m.previousAccuracy === 0 && m.recentAccuracy === 0
    ? 'flat'
    : delta > 0.001 ? 'up' : delta < -0.001 ? 'down' : 'flat';

  return (
    <div className="panel">
      <div className="card">
        <h2>حال زبير الآن</h2>
        <p>{summarize(m)}</p>
        {/* لا شريط «كم يحتاج ليكبر»: النموّ في ما يعرف لا في رخصةٍ ينالها بعدد
            كلماته، وقد حُذف سُلّم الأطوار كلُّه. */}
        <span className="hint">
          الذي منك {m.factsFromFather} حقيقة — وهو وحده مقياس تعليمك.
        </span>
      </div>

      <div className="card">
        <h2>الأرقام</h2>
        <div className="grid">
          <Stat value={m.vocab} label="كلمة يعرفها" />
          <Stat value={m.facts} label="حقيقة يعرفها" />
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

      <Mood mood={props.mood} list={props.moodList} />

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

/* ————— ما يشعر به الآن —————
 *
 * تُعرَض الستّ الأساسية والأربع المعقّدة معاً وبفصلٍ بيّن، لأن الفرق بينهما هو
 * أهمّ ما في الباب: الأساسية تنشأ من سببها مباشرةً، والمعقّدة لا تقوم إلا
 * باجتماع أطرافها — ولذلك تراها صفراً أكثر الوقت وهذا صواب لا عطل. */
function Mood(props: {
  mood: Feelings;
  list: ReadonlyArray<{ name: string; value: number; complex: boolean }>;
}) {
  const basic = props.list.filter((e) => !e.complex);
  const complex = props.list.filter((e) => e.complex);
  const dominant = props.mood.dominant;

  return (
    <div className="card">
      <h2>ما يشعر به الآن</h2>
      <p>
        {dominant
          ? <>أقوى ما فيه الآن <b>{dominant.name}</b> — {props.mood.reasonAr}.</>
          : <>هادئ: لا شيء بلغ شدّةً تُسمّى.</>}
      </p>

      <h3 className="sub">المشاعر الأساسية</h3>
      <ul className="moods">
        {basic.map((e) => <MoodBar key={e.name} name={e.name} value={e.value}
          on={dominant?.name === e.name} />)}
      </ul>

      <h3 className="sub">المشاعر المعقّدة — مزيجٌ من الأساسية</h3>
      <ul className="moods">
        {complex.map((e) => <MoodBar key={e.name} name={e.name} value={e.value}
          on={dominant?.name === e.name} />)}
      </ul>
      <p className="hint">
        الفخر سعادةٌ بإنجازٍ من عنده، والذنب حزنٌ وخوفٌ وغضبٌ يوجّهها إلى نفسه،
        والغيرة غضبٌ وحزنٌ مما عند غيره، والحنين محبّةٌ وحزنٌ على عهدٍ بَعُد. وإن
        غاب طرفٌ من المزيج سقط المزيج كلّه.
      </p>
    </div>
  );
}

function MoodBar(props: { name: string; value: number; on: boolean }) {
  return (
    <li className={props.on ? 'on' : ''}>
      <span>{props.name}</span>
      <div className="bar"><i style={{ width: `${Math.round(props.value * 100)}%` }} /></div>
      <em>{Math.round(props.value * 100)}٪</em>
    </li>
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
