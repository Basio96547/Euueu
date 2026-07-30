/* ————— الحفظ: طفل لا يُحفظ دماغه ينسى أباه —————
 *
 * الدماغ لا يعرف المتصفّح ولا الملفات، يعرف عقد StoragePort فقط. لذلك يعمل
 * نفسه داخل الجوال وداخل اختبارات Node بلا تغيير سطر.
 *
 * ثلاث طبقات سقوط: IndexedDB (تحمل ميغابايتات، وهي موضع دماغ ينمو)، ثم
 * localStorage (خمسة ميغابايت غالباً، تكفي أول شهور زبير)، ثم ذاكرة الجلسة
 * كحل أخير مُعلَن. الطبقة الأخيرة تعني نسياناً بعد الإغلاق، ولذلك تُصرّح
 * بحالها في describeAr كي يأخذ الأب نسخة احتياطية ولا يُفاجأ.
 */

import type { StoragePort } from './types.js';

const DB_NAME = 'zubair';
const STORE = 'brain';

export interface DescribedStorage extends StoragePort {
  /** وصف عربي لموضع الحفظ يظهر للأب */
  readonly describeAr: string;
}

/** تخزين في الذاكرة — للاختبارات، ولحالة فشل كل شيء في المتصفّح. */
export function memoryStorage(): DescribedStorage {
  const map = new Map<string, string>();
  return {
    describeAr: 'محفوظ في الذاكرة المؤقتة فقط — سيُنسى بعد الإغلاق',
    async read(key) {
      return map.get(key) ?? null;
    },
    async write(key, value) {
      map.set(key, value);
    },
    async remove(key) {
      map.delete(key);
    },
  };
}

/** تخزين على الجهاز مع سقوط متدرّج معلن. */
export function browserStorage(): DescribedStorage {
  if (hasIndexedDb()) return indexedDbStorage();
  if (hasLocalStorage()) return localStorageStorage();
  return memoryStorage();
}

function hasIndexedDb(): boolean {
  try {
    return typeof globalThis === 'object' && 'indexedDB' in globalThis && globalThis.indexedDB !== null;
  } catch {
    return false;
  }
}

function hasLocalStorage(): boolean {
  try {
    if (typeof globalThis !== 'object' || !('localStorage' in globalThis)) return false;
    // المتصفّح في وضع التخفّي قد يعرض localStorage ثم يرمي عند الكتابة، فلا
    // يكفي فحص الوجود: نكتب قيمة اختبار ونمحوها
    const probe = '__zubair_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function localStorageStorage(): DescribedStorage {
  const fallback = memoryStorage();
  return {
    describeAr: 'محفوظ في ذاكرة المتصفّح (localStorage)',
    async read(key) {
      try {
        return globalThis.localStorage.getItem(key);
      } catch {
        return fallback.read(key);
      }
    },
    async write(key, value) {
      try {
        globalThis.localStorage.setItem(key, value);
      } catch {
        // تجاوز الحصّة: نُبقي الدماغ في الذاكرة فلا تنهار الجلسة الحالية
        await fallback.write(key, value);
      }
    },
    async remove(key) {
      try {
        globalThis.localStorage.removeItem(key);
      } catch {
        await fallback.remove(key);
      }
    },
  };
}

function indexedDbStorage(): DescribedStorage {
  const fallback = hasLocalStorage() ? localStorageStorage() : memoryStorage();
  let opening: Promise<IDBDatabase> | null = null;

  /** IndexedDB واجهة أحداث لا وعود، فنلفّها بيدنا ونعالج كل مسار خطأ:
   *  دماغ لا يُحفظ يعني طفلاً ينسى أباه. */
  const open = (): Promise<IDBDatabase> => {
    if (opening) return opening;
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = globalThis.indexedDB.open(DB_NAME, 1);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('تعذّر فتح قاعدة البيانات'));
      // onblocked يقع حين تفتح نسخة قديمة من التطبيق نفس القاعدة في تبويب آخر
      request.onblocked = () => reject(new Error('قاعدة البيانات مشغولة في تبويب آخر'));
    });
    // فشل الفتح لا يُحفظ إلى الأبد: نُصفّر الوعد ليُعاد المحاولة لاحقاً
    opening.catch(() => {
      opening = null;
    });
    return opening;
  };

  const run = <T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          try {
            const tx = db.transaction(STORE, mode);
            const request = body(tx.objectStore(STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('فشل الطلب'));
            tx.onabort = () => reject(tx.error ?? new Error('أُلغيت المعاملة'));
          } catch (error) {
            reject(error);
          }
        }),
    );

  return {
    describeAr: 'محفوظ على جهازك (IndexedDB) — لا يخرج منه شيء',
    async read(key) {
      try {
        const value = await run<unknown>('readonly', (store) => store.get(key) as IDBRequest<unknown>);
        return typeof value === 'string' ? value : null;
      } catch {
        return fallback.read(key);
      }
    },
    async write(key, value) {
      try {
        await run('readwrite', (store) => store.put(value, key) as IDBRequest<IDBValidKey>);
      } catch {
        await fallback.write(key, value);
      }
    },
    async remove(key) {
      try {
        await run('readwrite', (store) => store.delete(key) as IDBRequest<undefined>);
      } catch {
        await fallback.remove(key);
      }
    },
  };
}

/** حجم ما يشغله زبير على الجهاز — دماغ ينمو على جوال محدود يجب أن يُقاس. */
export async function quotaHint(): Promise<{ usedBytes: number | null; note: string }> {
  try {
    const storage = (globalThis as { navigator?: { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } } })
      .navigator?.storage;
    if (!storage?.estimate) return { usedBytes: null, note: 'المتصفّح لا يُخبر بحجم ما يحفظه' };
    const estimate = await storage.estimate();
    const used = typeof estimate.usage === 'number' ? estimate.usage : null;
    const quota = typeof estimate.quota === 'number' ? estimate.quota : null;
    if (used === null) return { usedBytes: null, note: 'المتصفّح لا يُخبر بحجم ما يحفظه' };
    const mb = (used / (1024 * 1024)).toFixed(2);
    const note = quota
      ? `يشغل ${mb} ميغابايت من ${(quota / (1024 * 1024)).toFixed(0)} متاحة`
      : `يشغل ${mb} ميغابايت`;
    return { usedBytes: used, note };
  } catch {
    return { usedBytes: null, note: 'تعذّر قياس الحجم' };
  }
}
