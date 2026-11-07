import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, LogOut, Phone, QrCode, RefreshCw, X } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import type { SystemStatus } from '../api/types';
import { useLocale } from '../locale-context';

interface PairingModalProps {
  status: SystemStatus | null;
  isOpen: boolean;
  onClose: () => void;
  onConnect: (phone?: string) => void;
  onDisconnect: () => void;
}

export function PairingModal({ status, isOpen, onClose, onConnect, onDisconnect }: PairingModalProps) {
  const { tr } = useLocale();
  const [tab, setTab] = useState<'qr' | 'phone'>('qr');
  const [phoneNumber, setPhoneNumber] = useState('');

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="wa-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      {/* react-doctor-disable-next-line react-doctor/prefer-html-dialog */}
      <section className="wa-modal" role="dialog" aria-modal="true" aria-labelledby="pairing-title">
        <header className="wa-modal-header">
          <div className="wa-modal-heading">
            <span className="wa-modal-icon"><QrCode size={20} /></span>
            <div>
              <h2 id="pairing-title">{tr('ربط حساب واتساب', 'Link WhatsApp')}</h2>
              <p>{tr('ربط جهاز مرافق', 'Linked companion device')}</p>
            </div>
          </div>
          <button type="button" className="wa-icon-button" onClick={onClose} aria-label={tr('إغلاق', 'Close')}><X size={20} /></button>
        </header>
        <div className="wa-modal-content">
          {status?.state === 'connected' ? (
            <div className="wa-pairing-success">
              <span className="wa-modal-success-icon"><CheckCircle2 size={32} /></span>
              <h3>{tr('واتساب متصل بنجاح', 'WhatsApp is connected')}</h3>
              <p>{tr('الحساب:', 'Account:')} <strong dir="auto">{status.connectedUser?.name || status.connectedUser?.phone || 'WhatsApp'}</strong></p>
              <div className="wa-modal-actions">
                <Button variant="secondary" label={tr('فصل الحساب', 'Disconnect')} icon={<LogOut size={16} />} onClick={onDisconnect} />
                <Button variant="primary" label={tr('تم', 'Done')} onClick={onClose} />
              </div>
            </div>
          ) : (
            <>
              <div className="wa-modal-tabs" role="group" aria-label={tr('طريقة الربط', 'Pairing method')}>
                <button type="button" className={tab === 'qr' ? 'is-active' : ''} aria-pressed={tab === 'qr'} onClick={() => setTab('qr')}><QrCode size={16} /> {tr('رمز QR', 'QR code')}</button>
                <button type="button" className={tab === 'phone' ? 'is-active' : ''} aria-pressed={tab === 'phone'} onClick={() => setTab('phone')}><Phone size={16} /> {tr('كود الهاتف', 'Phone code')}</button>
              </div>
              {tab === 'qr' ? (
                <div className="wa-qr-panel">
                  <div className="wa-qr-frame">
                    {status?.qrDataUrl ? (
                      <img src={status.qrDataUrl} alt={tr('رمز واتساب للربط', 'WhatsApp pairing QR code')} />
                    ) : (
                      <div className="wa-qr-placeholder">
                        <QrCode size={46} strokeWidth={1.3} />
                        <span>{tr('رمز QR مش جاهز لسه', 'QR code is not ready yet')}</span>
                      </div>
                    )}
                  </div>
                  <ol className="wa-pairing-steps">
                    <li>{tr('افتح واتساب على موبايلك', 'Open WhatsApp on your phone')}</li>
                    <li>{tr('ادخل إلى الأجهزة المرتبطة', 'Go to Linked devices')}</li>
                    <li>{tr('اختار ربط جهاز وامسح الرمز', 'Tap Link a device and scan this code')}</li>
                  </ol>
                  <Button variant="ghost" label={tr('إنشاء رمز جديد', 'Generate a new code')} icon={<RefreshCw size={16} />} onClick={() => onConnect()} />
                </div>
              ) : (
                <div className="wa-phone-panel">
                  <label className="wa-field">
                    <span>{tr('رقم الهاتف بكود الدولة', 'Phone number with country code')}</span>
                    <input dir="ltr" type="tel" autoComplete="tel" placeholder="+201012345678" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} />
                  </label>
                  <p className="wa-field-help">{tr('هيظهر كود ربط من 8 أحرف تستخدمه داخل واتساب', 'You will receive an 8-character code to enter in WhatsApp')}</p>
                  {status?.pairingCode && (
                    <div className="wa-pairing-code">
                      <span>{tr('كود الربط', 'Pairing code')}</span>
                      <strong dir="ltr">{status.pairingCode}</strong>
                    </div>
                  )}
                  <Button variant="primary" width="100%" label={tr('طلب كود الربط', 'Request pairing code')} isDisabled={!phoneNumber.trim()} onClick={() => onConnect(phoneNumber)} />
                </div>
              )}
            </>
          )}
          {status?.error && <p className="wa-inline-error" role="alert"><AlertCircle size={15} /> {status.error}</p>}
        </div>
      </section>
    </div>
  );
}

