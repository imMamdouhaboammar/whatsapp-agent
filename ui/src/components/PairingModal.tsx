import { useState } from 'react';
import { CheckCircle2, Phone, QrCode, RefreshCw, LogOut } from 'lucide-react';
import type { SystemStatus } from '../api/types';
import { useLocale } from '../locale-context';
import { ConfirmAction, ToolDialog } from './ToolDialog';

interface PairingModalProps {
  status: SystemStatus | null;
  isOpen: boolean;
  onClose: () => void;
  onConnect: (phone?: string, refresh?: boolean) => void | Promise<void>;
  onDisconnect: () => void | Promise<void>;
}

export function PairingModal(props: PairingModalProps) {
  return props.isOpen ? <PairingContent {...props} /> : null;
}

function PairingContent({ status, onClose, onConnect, onDisconnect }: PairingModalProps) {
  const { tr } = useLocale();
  const [tab, setTab] = useState<'qr' | 'phone'>('qr');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const connecting = status?.state === 'connecting';
  const connected = status?.state === 'connected';
  const unavailable = status?.state === 'disabled';
  const digits = phone.replace(/[\s()+-]/g, '');
  const validPhone = /^[1-9]\d{6,14}$/.test(digits);
  const run = async (action: () => void | Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : tr('تعذّر إكمال الربط', 'Could not complete the connection request')); }
    finally { setBusy(false); }
  };
  return <>
    <ToolDialog title={tr('ربط حساب واتساب', 'Link WhatsApp')} description={tr('أدر اتصال حسابك بجهاز واتساب المرافق.', 'Manage your linked companion device.')} onClose={onClose} busy={busy} footer={connected ? <>
      <button type="button" className="wa-tool-button wa-tool-danger-outline" disabled={busy} onClick={() => setConfirmDisconnect(true)}><LogOut size={16}/>{tr('فصل الحساب', 'Disconnect')}</button>
      <button type="button" className="wa-tool-button wa-tool-primary" disabled={busy} onClick={onClose}>{tr('تم', 'Done')}</button>
    </> : <>
      <button type="button" className="wa-tool-button" disabled={busy} onClick={onClose}>{tr('إغلاق', 'Close')}</button>
      <button type="button" className="wa-tool-button wa-tool-primary" disabled={busy || unavailable || connecting || (tab === 'phone' && !validPhone)} onClick={() => void run(() => onConnect(tab === 'phone' ? digits : undefined, true))}>
        <RefreshCw size={16}/>{busy ? tr('جارٍ الطلب...', 'Requesting…') : tab === 'phone' ? tr('طلب كود الربط', 'Request pairing code') : tr('إنشاء رمز جديد', 'Generate QR code')}
      </button>
    </>}>
      <output className="wa-tool-status"><span className={connected ? 'wa-tool-dot is-connected' : 'wa-tool-dot'}/>{connected ? tr('متصل', 'Connected') : connecting ? tr('جارٍ الاتصال', 'Connecting') : unavailable ? tr('الربط غير متاح', 'Pairing unavailable') : status?.state === 'qr_ready' || status?.state === 'pairing_code_ready' ? tr('بانتظار تأكيد الهاتف', 'Waiting for phone confirmation') : tr('غير متصل', 'Not connected')}</output>
      {connected ? <div className="wa-link-account"><CheckCircle2 size={40}/><h3>{tr('واتساب متصل', 'WhatsApp is connected')}</h3><p dir="auto">{status.connectedUser?.name || status.connectedUser?.phone || 'WhatsApp'}</p></div> : <>
        <fieldset className="wa-tool-tabs" aria-label={tr('طريقة الربط', 'Pairing method')}>
          <button type="button" aria-pressed={tab === 'qr'} disabled={busy} onClick={() => setTab('qr')}><QrCode size={17}/>{tr('رمز QR', 'QR code')}</button>
          <button type="button" aria-pressed={tab === 'phone'} disabled={busy} onClick={() => setTab('phone')}><Phone size={17}/>{tr('كود الهاتف', 'Phone code')}</button>
        </fieldset>
        {tab === 'qr' ? <div className="wa-link-layout">
          <div className="wa-link-qr">{status?.qrDataUrl ? <img src={status.qrDataUrl} alt={tr('رمز واتساب للربط', 'WhatsApp pairing QR code')}/> : <div><QrCode size={42}/><p>{connecting ? tr('جارٍ إنشاء الرمز', 'Generating QR code…') : tr('اطلب رمز الربط أولًا', 'Generate a code to begin')}</p></div>}</div>
          <ol className="wa-link-steps"><li>{tr('افتح واتساب على هاتفك', 'Open WhatsApp on your phone')}</li><li>{tr('افتح الأجهزة المرتبطة', 'Open Linked devices')}</li><li>{tr('اختر ربط جهاز وامسح الرمز', 'Choose Link a device and scan the code')}</li></ol>
        </div> : <div className="wa-tool-stack">
          <label className="wa-tool-field">{tr('رقم الهاتف بكود الدولة', 'Phone number with country code')}<input dir="ltr" type="tel" autoComplete="tel" placeholder="+201012345678" value={phone} onChange={e => setPhone(e.target.value)} disabled={busy}/></label>
          <p className="wa-tool-note">{tr('أدخل كود الدولة بدون صفر في البداية. أدخل الكود الناتج في الأجهزة المرتبطة داخل واتساب.', 'Use the country code without a leading zero. Enter the resulting code in Linked devices on your phone.')}</p>
          {status?.pairingCode && <output className="wa-link-code"><span>{tr('كود الربط', 'Pairing code')}</span><strong dir="ltr">{status.pairingCode}</strong></output>}
        </div>}
      </>}
      {unavailable && <p className="wa-tool-note">{status.reason || tr('ربط الجهاز غير متاح في إعداد التشغيل الحالي.', 'Device pairing is unavailable in this runtime profile.')}</p>}
      {(error || status?.error) && <p role="alert" className="wa-tool-error">{error || status?.error}</p>}
    </ToolDialog>
    {confirmDisconnect && <ConfirmAction title={tr('فصل واتساب؟', 'Disconnect WhatsApp?')} description={tr('سيتوقف إرسال واستقبال الرسائل حتى إعادة الربط.', 'Messages will stop sending and receiving until you reconnect.')} confirmLabel={tr('فصل الحساب', 'Disconnect')} onClose={() => setConfirmDisconnect(false)} onConfirm={() => { setConfirmDisconnect(false); void run(onDisconnect); }}/>}
  </>;
}
