/**
 * قنوات الإرسال الفعلية (الفصل 20).
 * بلا رمز مزوّد تُكتب الرسالة في السجل — التطوير لا يرسل رسائل حقيقية،
 * والإنتاج يعمل بمجرد ضبط المتغيرات دون تغيير سطر كود.
 */
export interface SendResult { ok: boolean; channel: string; detail?: string }

const WA_TOKEN = process.env.WHATSAPP_PROVIDER_TOKEN;
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const SMS_TOKEN = process.env.SMS_PROVIDER_TOKEN;
const SMS_URL = process.env.SMS_PROVIDER_URL;
const SMS_SENDER = process.env.SMS_SENDER ?? 'TaliSham';

export async function sendWhatsapp(to: string, body: string): Promise<SendResult> {
  if (!WA_TOKEN || !WA_PHONE_ID) {
    console.log(`[واتساب · محاكاة] ${to}: ${body}`);
    return { ok: true, channel: 'WHATSAPP', detail: 'simulated' };
  }
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${WA_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: to.replace('+', ''),
        type: 'text', text: { preview_url: false, body },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return { ok: false, channel: 'WHATSAPP', detail: `HTTP ${r.status}` };
    return { ok: true, channel: 'WHATSAPP' };
  } catch (e) {
    return { ok: false, channel: 'WHATSAPP', detail: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function sendSms(to: string, body: string): Promise<SendResult> {
  if (!SMS_TOKEN || !SMS_URL) {
    console.log(`[SMS · محاكاة] ${to}: ${body}`);
    return { ok: true, channel: 'SMS', detail: 'simulated' };
  }
  try {
    const r = await fetch(SMS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${SMS_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ to, sender: SMS_SENDER, text: body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return { ok: false, channel: 'SMS', detail: `HTTP ${r.status}` };
    return { ok: true, channel: 'SMS' };
  } catch (e) {
    return { ok: false, channel: 'SMS', detail: e instanceof Error ? e.message : 'unknown' };
  }
}
