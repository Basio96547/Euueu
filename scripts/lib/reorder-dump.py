#!/usr/bin/env python3
"""
إعادة ترتيب نسخة D1 قبل استعادتها.

`wrangler d1 export` يُخرج الجداول واحداً واحداً: إنشاءُ جدولٍ ثم إدخالُ
صفوفه ثم الذي يليه. وهو ترتيبٌ لا يُستعاد: صفٌّ في `device_units` يشير
إلى `order_items` الذي لم يُنشأ بعد، فيسقط الاستعادةَ كلها بـ«no such
table». والـ`PRAGMA defer_foreign_keys` في رأس الملف لا يُجدي لأنه لا
يعبر حدود الجملة حين تُنفَّذ الجُمل واحدةً واحدة.

وأخطر منه المحفِّزات: `trg_units_match_levels` يقارن الوحدات بعدّاد
المخزون عند كل كتابة. فإن أُنشئ قبل إدخال البيانات، رفض صفوفاً صحيحة
لأنها تصل مبعثرةً لا دفعةً واحدة — أي أن الحارس نفسه يمنع استعادة ما
حرسه.

فالترتيب الصحيح أربع مراحل:
    1. الجداول    — كلها أولاً، فلا مرجعَ إلى معدوم
    2. البيانات   — مرتَّبةً طوبولوجياً: الأب قبل ابنه
    3. الفهارس    — بعد الإدخال، فبناؤها مرةً أسرع من تحديثها صفاً صفاً
    4. المحفِّزات  — آخراً، فلا تحكم على بياناتٍ وهي تُنقَل

وترتيب البيانات وحده لا يكفي أن يكون «كما خرج»: صفٌّ في `orders` يشير
إلى عنوانٍ في `addresses`، فإن سبقه سقط بـFOREIGN KEY constraint failed.
فتُقرأ العلاقات من جُمل الإنشاء نفسها ويُرتَّب الإدخال عليها. والدورات
— جدولان يشير كلٌّ إلى الآخر — تُكسر بترتيبها الأصلي: أفضل ما يمكن،
ولا نعتمد على `PRAGMA` قد لا يعبر حدود الجملة عند التنفيذ.

ويسبق المراحلَ الأربعَ مسحٌ. فالتصدير يكتب `CREATE TABLE IF NOT EXISTS`
لا `CREATE TABLE`: الجداول تمرّ صامتةً على قاعدةٍ غير فارغة، ثم يسقط أول
`CREATE UNIQUE INDEX` بـ«already exists». والأسوأ من سقوطه أن يمرّ: قاعدةٌ
نصفُ صفوفها من النسخة ونصفها ممّا كان قبلها، ولا يُعرف أيّهما. فيُمحى
أولاً كلُّ ما تُنشئه النسخة — بعكس ترتيب النسب: الابن قبل أبيه، وإلا رفض
SQLite حذف أبٍ له ذرّية. وما ليس في النسخة لا يُمسّ.

    python3 reorder-dump.py < dump.sql > ordered.sql
"""
import re
import sys


def split_statements(sql: str):
    """فصل الجُمل. المحفِّز يحوي فاصلةً منقوطة داخله فيُعامَل ككتلة واحدة."""
    out, buf, depth, in_trigger = [], [], 0, False

    for line in sql.split('\n'):
        st = line.strip()
        if not st and not buf:
            continue
        if st.startswith('--') and not buf:
            continue
        buf.append(line)

        if re.match(r'^CREATE\s+TRIGGER', st, re.I):
            in_trigger = True
        if in_trigger:
            if st.upper() == 'END;':
                out.append('\n'.join(buf).strip())
                buf, in_trigger = [], False
            continue

        depth += line.count('(') - line.count(')')
        if st.endswith(';') and depth <= 0:
            out.append('\n'.join(buf).strip())
            buf, depth = [], 0

    if buf:
        out.append('\n'.join(buf).strip())
    return [s for s in out if s and not s.startswith('--')]


TABLE_RE = re.compile(r'^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([A-Za-z_][A-Za-z0-9_]*)"?', re.I)
FK_RE = re.compile(r'REFERENCES\s+"?([A-Za-z_][A-Za-z0-9_]*)"?', re.I)
INSERT_RE = re.compile(r'^INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?([A-Za-z_][A-Za-z0-9_]*)"?', re.I)
INDEX_RE = re.compile(r'^CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([A-Za-z_][A-Za-z0-9_]*)"?', re.I)
TRIGGER_RE = re.compile(r'^CREATE\s+TRIGGER(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([A-Za-z_][A-Za-z0-9_]*)"?', re.I)
VIEW_RE = re.compile(r'^CREATE\s+VIEW(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([A-Za-z_][A-Za-z0-9_]*)"?', re.I)
DELETE_RE = re.compile(r'^DELETE\s+FROM\s+', re.I)


def table_order(creates):
    """ترتيبٌ طوبولوجي: الأب قبل ابنه. والدورة تُكسر بالترتيب الأصلي."""
    deps, order = {}, []
    for stmt in creates:
        m = TABLE_RE.match(stmt.lstrip())
        if not m:
            continue
        name = m.group(1)
        order.append(name)
        # الإشارة إلى النفس لا تُعدّ تبعية: صفٌّ يشير إلى صفٍّ في جدوله
        deps[name] = {r for r in FK_RE.findall(stmt) if r != name}

    done, out, guard = set(), [], 0
    while len(out) < len(order) and guard <= len(order):
        guard += 1
        progressed = False
        for t in order:
            if t in done:
                continue
            if deps.get(t, set()) <= done | (deps.get(t, set()) - set(order)):
                out.append(t); done.add(t); progressed = True
        if not progressed:
            break
    # ما بقي في دورة: يُلحَق بترتيبه الأصلي
    out += [t for t in order if t not in done]
    return {name: i for i, name in enumerate(out)}


def drop_prelude(stmts, rank):
    """مسحُ ما ستُنشئه النسخة، لا أكثر. الابن قبل أبيه وإلا رفض SQLite."""
    def names(rx, want):
        return [m.group(1) for s in stmts
                if bucket(s) == want and (m := rx.match(s.lstrip()))]

    out = []
    # المحفِّزات أولاً: لئلا تحكم على جداولَ وهي تُمحى
    out += [f'DROP TRIGGER IF EXISTS "{n}";' for n in names(TRIGGER_RE, 3)]
    out += [f'DROP VIEW IF EXISTS "{n}";' for n in names(VIEW_RE, 3)]
    out += [f'DROP INDEX IF EXISTS "{n}";' for n in names(INDEX_RE, 2)]

    tables = names(TABLE_RE, 0)
    for n in sorted(tables, key=lambda t: -rank.get(t, 10_000)):
        out.append(f'DROP TABLE IF EXISTS "{n}";')
    return out


def bucket(stmt: str) -> int:
    head = stmt.lstrip()[:80].upper()
    if head.startswith('PRAGMA'):
        return -1                      # يُسقَط: لا يعبر حدود الجملة فلا معنى له
    if head.startswith('CREATE TABLE'):
        return 0
    if head.startswith('INSERT'):
        return 1
    if head.startswith('CREATE INDEX') or head.startswith('CREATE UNIQUE INDEX'):
        return 2
    if head.startswith('CREATE TRIGGER'):
        return 3
    if head.startswith('CREATE VIEW'):
        return 3
    return 1                           # مجهول: يُعامَل كبيانات، بترتيبه الأصلي


def main() -> int:
    stmts = split_statements(sys.stdin.read())
    creates = [s for s in stmts if bucket(s) == 0]
    rank = table_order(creates)

    def key(g):
        b, i, s = g
        if b == 1:                            # الإدخال: الأب قبل ابنه
            m = INSERT_RE.match(s.lstrip())
            if m:
                return (b, rank.get(m.group(1), 10_000), i)
            # `DELETE FROM sqlite_sequence` يعني «صفِّر العدّادات قبل التحميل».
            # فإن تأخّر عن الإدخال محا العدّاد الذي جاء يُصفّره: و`d1_migrations`
            # مفتاحُها AUTOINCREMENT، فتُطبَّق أول هجرةٍ بعدها على رقمٍ مأخوذ.
            if DELETE_RE.match(s.lstrip()):
                return (b, -1, i)
            return (b, 10_000, i)
        if b == 0:                            # الإنشاء: بالترتيب نفسه، للقراءة
            m = TABLE_RE.match(s.lstrip())
            return (b, rank.get(m.group(1), 10_000) if m else 10_000, i)
        return (b, i, 0)

    graded = [(bucket(s), i, s) for i, s in enumerate(stmts)]
    kept = sorted((g for g in graded if g[0] >= 0), key=key)

    labels = ['جدولاً', 'إدخالاً', 'فهرساً', 'محفِّزاً']
    counts = [sum(1 for g in kept if g[0] == b) for b in range(4)]
    print('-- أُعيد ترتيبها: '
          + ' · '.join(f'{c} {l}' for c, l in zip(counts, labels)), file=sys.stderr)

    if counts[0] == 0:
        print('-- لا جداول في النسخة — لن تُستعاد', file=sys.stderr)
        return 1

    drops = drop_prelude(stmts, rank)
    print(f'-- ومسحٌ قبلها: {len(drops)} كائناً', file=sys.stderr)
    for d in drops:
        sys.stdout.write(d + '\n')

    for _, _, s in kept:
        sys.stdout.write(s.rstrip().rstrip(';') + ';\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
