import { useState } from 'react';
import { QrCode, Phone, CheckCircle2, AlertCircle, RefreshCw, X, LogOut } from 'lucide-react';
import type { SystemStatus } from '../api/types';

interface PairingModalProps {
  status: SystemStatus | null;
  isOpen: boolean;
  onClose: () => void;
  onConnect: (phone?: string) => void;
  onDisconnect: () => void;
}

export function PairingModal({ status, isOpen, onClose, onConnect, onDisconnect }: PairingModalProps) {
  const [tab, setTab] = useState<'qr' | 'phone'>('qr');
  const [phoneNumber, setPhoneNumber] = useState('');

  if (!isOpen) return null;

  const isConnected = status?.state === 'connected';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-[#131922] border border-[#263140] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#263140] bg-[#0b0f14]/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
              <QrCode className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">ربط حساب واتساب</h2>
              <p className="text-xs text-slate-400">WhatsApp Companion Link</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-[#1c2430] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {isConnected ? (
            <div className="flex flex-col items-center text-center py-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-semibold text-slate-100">متصل بنجاح بالواتساب!</h3>
              <p className="text-sm text-slate-400 mt-1">
                الحساب: <span className="text-emerald-400 font-mono">{status?.connectedUser?.name || status?.connectedUser?.phone || 'WhatsApp Account'}</span>
              </p>
              <div className="mt-6 flex gap-3">
                <button
                  onClick={onDisconnect}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-sm font-medium transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  تسجيل الخروج
                </button>
                <button
                  onClick={onClose}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors shadow-lg shadow-emerald-900/20"
                >
                  تم
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-[#0b0f14] rounded-xl border border-[#263140] mb-6">
                <button
                  onClick={() => setTab('qr')}
                  className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all ${
                    tab === 'qr'
                      ? 'bg-[#1c2430] text-emerald-400 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <QrCode className="w-3.5 h-3.5" />
                  رمز الـ QR
                </button>
                <button
                  onClick={() => setTab('phone')}
                  className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all ${
                    tab === 'phone'
                      ? 'bg-[#1c2430] text-emerald-400 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Phone className="w-3.5 h-3.5" />
                  كود الهاتف
                </button>
              </div>

              {tab === 'qr' ? (
                <div className="flex flex-col items-center text-center">
                  <div className="p-3 bg-white rounded-2xl shadow-xl border border-slate-700/50 mb-4">
                    {status?.qrDataUrl ? (
                      <img src={status.qrDataUrl} alt="WhatsApp QR Code" className="w-52 h-52 rounded-lg" />
                    ) : (
                      <div className="w-52 h-52 flex flex-col items-center justify-center text-slate-600 gap-2">
                        <RefreshCw className="w-6 h-6 animate-spin text-emerald-500" />
                        <span className="text-xs text-slate-500 font-medium">جاري تجهيز رمز QR...</span>
                      </div>
                    )}
                  </div>
                  <ol className="text-xs text-slate-400 text-right space-y-1.5 list-decimal list-inside px-2">
                    <li>افتح تطبيق واتساب على هاتفك</li>
                    <li>اضغط على الإعدادات أو الثلاث نقاط واختر <strong>الأجهزة المرتبطة (Linked Devices)</strong></li>
                    <li>اضغط على <strong>ربط جهاز (Link a Device)</strong> ووجه الكاميرا نحو الرمز</li>
                  </ol>
                  <button
                    onClick={() => onConnect()}
                    className="mt-5 flex items-center gap-1.5 text-xs text-slate-400 hover:text-emerald-400 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    تحديث الرمز
                  </button>
                </div>
              ) : (
                <div className="flex flex-col text-right">
                  <label className="text-xs font-medium text-slate-300 mb-2">رقم الهاتف الدولي (مع كود الدولة):</label>
                  <input
                    type="tel"
                    placeholder="مثال: +201012345678"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-[#0b0f14] border border-[#263140] rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-hidden focus:border-emerald-500"
                    dir="ltr"
                  />
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    سيتم توليد كود ربط مكون من 8 أحرف تدخل به على الواتساب دون الحاجة لمسح QR.
                  </p>

                  {status?.pairingCode && (
                    <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-center">
                      <div className="text-xs text-slate-400 mb-1">كود الربط الخاص بك:</div>
                      <div className="text-2xl font-mono font-bold tracking-widest text-emerald-400">
                        {status.pairingCode}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-2">
                        افتح إشعار الواتساب على هاتفك وأدخل هذا الكود
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => onConnect(phoneNumber)}
                    disabled={!phoneNumber.trim()}
                    className="mt-5 w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-colors shadow-lg shadow-emerald-900/20"
                  >
                    طلب كود الربط
                  </button>
                </div>
              )}
            </>
          )}

          {status?.error && status?.state !== 'qr_ready' && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2 text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{status.error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
