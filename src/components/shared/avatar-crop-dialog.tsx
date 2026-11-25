'use client';

/**
 * Crop / adjust a profile photo before upload.
 * The user drags the photo inside a square frame and zooms with a slider; "Save" returns a
 * 512x512 JPEG File. No extra dependency: plain canvas.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTranslations } from '@/i18n/use-translations';

const FRAME = 280;   // on-screen crop square (px)
const OUTPUT = 512;  // exported size (px)

const TEXT = {
  ar: { title: 'ضبط الصورة الشخصية', hint: 'اسحب الصورة لتحريكها واستخدم المقياس للتكبير.', zoom: 'تكبير', save: 'حفظ ورفع', cancel: 'إلغاء' },
  en: { title: 'Adjust profile photo', hint: 'Drag the photo to move it and use the slider to zoom.', zoom: 'Zoom', save: 'Save and upload', cancel: 'Cancel' },
};

interface Props {
  file: File | null;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
}

export default function AvatarCropDialog({ file, onCancel, onConfirm }: Props) {
  const { locale } = useTranslations();
  const L = locale === 'en' ? TEXT.en : TEXT.ar;
  const [url, setUrl] = useState('');
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // image center offset from frame center, in frame px
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    if (!file) { setUrl(''); setImg(null); return; }
    const u = URL.createObjectURL(file);
    setUrl(u);
    const i = new Image();
    i.onload = () => { setImg(i); setZoom(1); setPos({ x: 0, y: 0 }); };
    i.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // Base scale makes the shorter side exactly fill the frame; zoom multiplies it.
  const base = img ? FRAME / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const scale = base * zoom;
  const w = img ? img.naturalWidth * scale : 0;
  const h = img ? img.naturalHeight * scale : 0;

  const clamp = (p: { x: number; y: number }) => ({
    x: Math.max(-(w - FRAME) / 2, Math.min((w - FRAME) / 2, p.x)),
    y: Math.max(-(h - FRAME) / 2, Math.min((h - FRAME) / 2, p.y)),
  });

  // Keep the image covering the frame when zoom changes.
  useEffect(() => { setPos((p) => clamp(p)); }, [zoom, img]);

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPos(clamp({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y }));
  };
  const onUp = () => { drag.current = null; };

  const save = async () => {
    if (!img || !file) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // Source rectangle (in image pixels) that is visible inside the frame.
      const sx = (img.naturalWidth - FRAME / scale) / 2 - pos.x / scale;
      const sy = (img.naturalHeight - FRAME / scale) / 2 - pos.y / scale;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, OUTPUT, OUTPUT);
      ctx.drawImage(img, sx, sy, FRAME / scale, FRAME / scale, 0, 0, OUTPUT, OUTPUT);
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
      if (!blob) return;
      const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      onConfirm(new File([blob], name, { type: 'image/jpeg' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!file} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{L.title}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{L.hint}</p>
        <div className="flex justify-center">
          <div
            className="relative overflow-hidden rounded-full bg-muted touch-none cursor-grab active:cursor-grabbing"
            style={{ width: FRAME, height: FRAME }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            {img && url && (
              <img
                src={url}
                alt=""
                draggable={false}
                className="absolute max-w-none select-none pointer-events-none"
                style={{ width: w, height: h, left: FRAME / 2 - w / 2 + pos.x, top: FRAME / 2 - h / 2 + pos.y }}
              />
            )}
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <span>{L.zoom}</span>
          <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1" />
        </label>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{L.cancel}</Button>
          <Button type="button" onClick={save} disabled={busy || !img}>
            {busy && <Loader2 className="h-4 w-4 animate-spin me-2" />}{L.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
