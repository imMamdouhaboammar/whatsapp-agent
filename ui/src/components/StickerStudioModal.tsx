import { useState, useRef, type ChangeEvent } from 'react';
import { Image as ImageIcon, Send, Smile, X, Check, AlertCircle } from 'lucide-react';
import { Tag } from '@lobehub/ui';
import { api } from '../api/client';
import { useLocale } from '../locale-context';
import { useModalDismiss } from '../hooks/useModalDismiss';

interface StickerStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedChatId?: string;
  onSendSticker?: (chatId: string, stickerBase64: string) => Promise<void>;
}

export function StickerStudioModal({ isOpen, onClose, selectedChatId, onSendSticker }: StickerStudioModalProps) {
  const { tr } = useLocale();
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const mimeTypeRef = useRef<string>('image/png');
  const [caption, setCaption] = useState<string>('');
  const [crop, setCrop] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedSticker, setGeneratedSticker] = useState<{
    bytes: number;
    base64: string;
  } | null>(null);

  useModalDismiss(isOpen, onClose);

  if (!isOpen) return null;

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setError(tr('نوع الصورة غير مدعوم (استخدم PNG أو JPG أو WebP)', 'Unsupported image type (use PNG, JPG, or WebP)'));
      return;
    }

    mimeTypeRef.current = file.type;
    setError(null);
    setGeneratedSticker(null);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1];
      setImageBase64(base64Data);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = async () => {
    if (!imageBase64) return;
    setLoading(true);
    setError(null);

    try {
      const res = await api.createSticker({
        imageBase64,
        mimeType: mimeTypeRef.current,
        crop,
        text: caption.trim() || undefined,
      });

      if (res.success && res.bytes !== undefined && res.stickerBase64) {
        setGeneratedSticker({
          bytes: res.bytes,
          base64: res.stickerBase64,
        });
      } else {
        setError(res.error || tr('فشل تحويل الاستيكر', 'Sticker creation failed'));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || tr('فشل في المعالجة', 'Processing failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!generatedSticker || !selectedChatId || !onSendSticker) return;
    try {
      await onSendSticker(selectedChatId, generatedSticker.base64);
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || tr('فشل الإرسال', 'Failed to send'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 text-slate-100 flex flex-col gap-5">
        <header className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Smile className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-semibold">{tr('استوديو ملصقات واتساب', 'WhatsApp Sticker Studio')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
            aria-label={tr('إغلاق', 'Close')}
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/50 border border-red-800/60 text-red-300 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Upload area */}
        <div className="flex flex-col gap-2">
          <label htmlFor="sticker-source-file-input" className="text-sm text-slate-300 font-medium">
            {tr('اختر صورة المصدر', 'Select source image')}
          </label>
          <input
            id="sticker-source-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleFileChange}
            className="text-sm text-emerald-100 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-500 cursor-pointer"
          />
        </div>

        {/* Options */}
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              {tr('كتابة نص توضيحي (كابشن على الملصق - اختياري)', 'Text caption overlay (optional, max 80 chars)')}
            </label>
            <input
              type="text"
              maxLength={80}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={tr('مثال: VIP Only أو مبروك النجاح', 'e.g. VIP Only or Good Luck')}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={crop}
              onChange={(e) => setCrop(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700 text-emerald-600 focus:ring-emerald-500"
            />
            <span>{tr('قص مركزي مربع (Square Center Crop)', 'Center square crop')}</span>
          </label>
        </div>

        {/* Preview section */}
        {generatedSticker && (
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src={`data:image/webp;base64,${generatedSticker.base64}`}
                alt="Sticker Preview"
                className="w-16 h-16 object-contain rounded-lg border border-slate-800 bg-slate-900"
              />
              <div>
                <p className="text-sm font-medium text-emerald-400 flex items-center gap-1">
                  <Check className="w-4 h-4" />
                  {tr('ملصق WebP جاهز', 'WebP Sticker Ready')}
                </p>
                <div className="mt-1">
                  <Tag
                    color={generatedSticker.bytes <= 101888 ? 'green' : 'volcano'}
                    variant="filled"
                    size="small"
                  >
                    {Math.round(generatedSticker.bytes / 1024)} KB / {tr('الحد 100 كيلوبايت', '100 KB limit')}
                  </Tag>
                </div>
              </div>
            </div>

            <a
              href={`data:image/webp;base64,${generatedSticker.base64}`}
              download="whatsapp-sticker.webp"
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition"
            >
              {tr('تحميل WebP', 'Download')}
            </a>
          </div>
        )}

        <footer className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 transition"
          >
            {tr('إلغاء', 'Cancel')}
          </button>

          {!generatedSticker ? (
            <button
              type="button"
              disabled={!imageBase64 || loading}
              onClick={handleGenerate}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-medium text-white transition flex items-center gap-2"
            >
              <ImageIcon className="w-4 h-4" />
              <span>{loading ? tr('جاري التحويل...', 'Converting...') : tr('إنشاء الملصق', 'Create Sticker')}</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={!selectedChatId || !onSendSticker}
              onClick={handleSend}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-medium text-white transition flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              <span>{tr('إرسال للمحادثة المحددة', 'Send to Chat')}</span>
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
