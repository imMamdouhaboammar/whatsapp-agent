import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Check, Download, ImagePlus, Send, Square, Crop } from 'lucide-react';
import { api } from '../api/client';
import { useLocale } from '../locale-context';
import { ToolDialog } from './ToolDialog';

interface StickerStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedChatId?: string;
  selectedChatName?: string;
  canSend?: boolean;
}

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_STICKER_BYTES = 101888;
const SIZE = 512;

async function prepareSticker(file: File, crop: boolean, caption: string): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 32_000_000) throw new Error('Image resolution exceeds the supported limit (32 MP)');
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image editing is unavailable in this browser');
    const scale = (crop ? Math.max : Math.min)(SIZE / bitmap.width, SIZE / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (SIZE - width) / 2, (SIZE - height) / 2, width, height);
    if (caption.trim()) {
      context.font = '600 28px Arial, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const lines: string[] = [];
      let line = '';
      for (const char of caption.trim()) {
        if (context.measureText(line + char).width > 440 && line) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
      if (line) lines.push(line);
      const blockHeight = lines.length * 36 + 24;
      context.fillStyle = 'rgba(0, 0, 0, 0.76)';
      context.fillRect(12, SIZE - blockHeight - 12, SIZE - 24, blockHeight);
      context.fillStyle = '#ffffff';
      lines.forEach((text, index) => context.fillText(text, SIZE / 2, SIZE - blockHeight + 18 + index * 36, 440));
    }
    const encoded = canvas.toDataURL('image/png').split(',')[1];
    if (!encoded) throw new Error('Could not encode image');
    return encoded;
  } finally {
    bitmap.close();
  }
}

export function StickerStudioModal(props: StickerStudioModalProps) {
  return props.isOpen ? <StickerStudioContent {...props} /> : null;
}

function StickerStudioContent({ onClose, selectedChatId, selectedChatName, canSend }: StickerStudioModalProps) {
  const { tr } = useLocale();
  const [target] = useState({ id: selectedChatId, name: selectedChatName });
  const [source, setSource] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const urlRef = useRef('');
  const [caption, setCaption] = useState('');
  const [crop, setCrop] = useState(true);
  const [busy, setBusy] = useState<'create' | 'send' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [generated, setGenerated] = useState<{ bytes: number; base64: string; mutationId: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setGenerated(null);
    setSubmitted(false);
    setNotice('');
    setError('');
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = '';
    setSource(null);
    setSourceUrl('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_SOURCE_BYTES || !file.size) {
      setError(tr('اختر صورة PNG أو JPG أو WebP بحجم لا يتجاوز 10 MB', 'Choose a PNG, JPG or WebP image up to 10 MB'));
      return;
    }
    urlRef.current = URL.createObjectURL(file);
    setSourceUrl(urlRef.current);
    setSource(file);
  }

  async function generate() {
    if (!source || busy) return;
    setBusy('create');
    setError('');
    setNotice('');
    setGenerated(null);
    setSubmitted(false);
    try {
      const imageBase64 = await prepareSticker(source, crop, caption);
      const result = await api.createSticker({ imageBase64, mimeType: 'image/png' });
      if (!result.success || !result.stickerBase64 || !Number.isInteger(result.bytes) || result.bytes === undefined || result.bytes <= 0 || result.bytes > MAX_STICKER_BYTES || atob(result.stickerBase64).length !== result.bytes) {
        throw new Error(result.error || tr('لم يتم إنشاء ملصق صالح', 'A valid sticker could not be created'));
      }
      setGenerated({ bytes: result.bytes, base64: result.stickerBase64, mutationId: crypto.randomUUID() });
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('تعذّر إنشاء الملصق', 'Could not create sticker'));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!target.id || target.id !== selectedChatId || !generated || !canSend || busy || submitted) return;
    setBusy('send');
    setError('');
    try {
      const result = await api.sendSticker(target.id, generated.base64, generated.mutationId);
      setSubmitted(true);
      setNotice(result.success ? tr('تم قبول الملصق للإرسال إلى المحادثة المحددة', 'Sticker accepted for delivery') :
        tr('تم تسجيل الطلب. راجع حالة الإرسال في المحادثة قبل محاولة الإرسال مرة أخرى', 'Request recorded. Check the conversation delivery status before sending again'));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('تعذّر تأكيد الإرسال. أعد المحاولة بنفس الملصق', 'Delivery could not be confirmed. Retry the same sticker'));
    } finally {
      setBusy(null);
    }
  }

  const outputUrl = generated ? `data:image/webp;base64,${generated.base64}` : '';
  const available = Boolean(target.id && target.id === selectedChatId && canSend);
  return <ToolDialog wide title={tr('استوديو ملصقات واتساب', 'WhatsApp Sticker Studio')}
    description={tr('حوّل صورة إلى ملصق مربع، ثم حمّله أو أرسله في المحادثة', 'Create a square sticker, download it or send it to your conversation')}
    onClose={onClose} busy={Boolean(busy)} footer={<>
      <button type="button" className="wa-tool-button" onClick={onClose} disabled={Boolean(busy)}>{tr('إغلاق', 'Close')}</button>
      {generated && <a className="wa-tool-button" href={outputUrl} download="whatsapp-sticker.webp"><Download size={16} />{tr('تحميل', 'Download')}</a>}
      {generated ? <button type="button" className="wa-tool-button wa-tool-primary" disabled={!available || Boolean(busy) || submitted} onClick={() => void send()}><Send size={16} />{busy === 'send' ? tr('جارٍ الإرسال', 'Sending…') : tr('إرسال الملصق', 'Send sticker')}</button> :
        <button type="button" className="wa-tool-button wa-tool-primary" disabled={!source || Boolean(busy)} onClick={() => void generate()}>{busy === 'create' ? tr('جارٍ التحويل', 'Creating…') : tr('إنشاء الملصق', 'Create sticker')}</button>}
    </>}>
    <div className="wa-sticker-layout">
      <div className="wa-sticker-editor">
        <label className="wa-tool-field"><span>{tr('الصورة الأصلية', 'Source image')}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={Boolean(busy)} onChange={selectImage} />
        </label>
        <p className="wa-tool-note">PNG / JPG / WebP · 10 MB</p>
        <fieldset className="wa-tool-field" disabled={Boolean(busy)}>
          <legend>{tr('ملاءمة الصورة', 'Image fit')}</legend>
          <div className="wa-tool-segment">
            <button type="button" aria-pressed={crop} onClick={() => { setCrop(true); setGenerated(null); setNotice(''); }}><Crop size={17}/>{tr('قص مربع', 'Crop')}</button>
            <button type="button" aria-pressed={!crop} onClick={() => { setCrop(false); setGenerated(null); setNotice(''); }}><Square size={17}/>{tr('كامل الصورة', 'Fit')}</button>
          </div>
        </fieldset>
        <label className="wa-tool-field"><span>{tr('نص على الملصق (اختياري)', 'Sticker caption (optional)')}</span>
          <input value={caption} maxLength={80} disabled={Boolean(busy)} onChange={event => { setCaption(event.target.value); setGenerated(null); setNotice(''); }} placeholder={tr('اكتب عبارة قصيرة', 'Add a short caption')} />
        </label>
        <p className="wa-tool-note">{caption.length}/80</p>
      </div>
      <div className="wa-sticker-preview">
        <div className="wa-tool-row"><strong>{generated ? tr('الملصق النهائي', 'Final sticker') : tr('معاينة المصدر', 'Source preview')}</strong><span className="wa-tool-note">512 × 512</span></div>
        <div className="wa-sticker-canvas">
          {outputUrl ? <img src={outputUrl} alt={tr('الملصق الناتج', 'Generated sticker')} /> : sourceUrl ? <img src={sourceUrl} className={crop ? 'wa-sticker-crop' : ''} alt={tr('الصورة الأصلية', 'Source image')} /> : <div className="wa-tool-empty"><ImagePlus size={30}/><span>{tr('اختر صورة للبدء', 'Choose an image to begin')}</span></div>}
        </div>
        {generated && <div className="wa-tool-status"><Check size={16}/><span>WebP · {(generated.bytes / 1024).toFixed(1)} KB</span></div>}
      </div>
    </div>
    <div className="wa-tool-recipient"><strong>{tr('المستلم', 'Recipient')}</strong><span>{target.name || target.id || tr('لم يتم تحديد محادثة', 'No conversation selected')}</span>
      {!available && <p className="wa-tool-note">{tr('التحميل متاح. للإرسال، اختر محادثة واتساب متصلة عبر Baileys', 'Download is available. Sending requires a selected chat and a connected Baileys session')}</p>}
    </div>
    {error && <p className="wa-tool-error" role="alert">{error}</p>}
    {notice && <output className="wa-tool-status">{notice}</output>}
  </ToolDialog>;
}
