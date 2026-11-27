'use client';

import { tr } from '@/lib/tr';
import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Face check in the browser/app. Models run on the phone (open source face-api, loaded from a CDN, free).
// Only a 128-number embedding leaves the phone; the photo never does. The server does the matching.

const BASE = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13';
let loading: Promise<any> | null = null;

function loadFaceApi(): Promise<any> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const done = async () => {
      try {
        const f = (window as any).faceapi;
        await Promise.all([
          f.nets.tinyFaceDetector.loadFromUri(`${BASE}/model`),
          f.nets.faceLandmark68Net.loadFromUri(`${BASE}/model`),
          f.nets.faceRecognitionNet.loadFromUri(`${BASE}/model`),
        ]);
        resolve(f);
      } catch (e) { loading = null; reject(e); }
    };
    if ((window as any).faceapi) { void done(); return; }
    const s = document.createElement('script');
    s.src = `${BASE}/dist/face-api.js`;
    s.onload = () => void done();
    s.onerror = () => { loading = null; reject(new Error('load')); };
    document.head.appendChild(s);
  });
  return loading;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function FaceCapture({ mode, onDone }: { mode: 'enroll' | 'verify'; onDone: (embeddings: number[][] | null, error?: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState(tr('بنجهز الكاميرا...', 'Starting the camera...'));
  const [busy, setBusy] = useState(true);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        const f = await loadFaceApi();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 480, height: 480 }, audio: false });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        setBusy(false);
        const opts = new f.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
        const detect = async () => f.detectSingleFace(v, opts).withFaceLandmarks().withFaceDescriptor();
        const yaw = (r: any) => {
          const p = r.landmarks.positions;
          return (p[30].x - p[0].x) / Math.max(1, p[16].x - p[0].x);
        };
        const frontal = (r: any) => Math.abs(yaw(r) - 0.5) < 0.08 && r.detection.score > 0.6;
        const out: number[][] = [];

        if (mode === 'enroll') {
          setMsg(tr('بصّ للكاميرا وخلي وشك واضح', 'Look at the camera and keep your face clear'));
          const t0 = Date.now();
          while (out.length < 3 && Date.now() - t0 < 60000 && !cancelled.current) {
            const r = await detect();
            if (r && frontal(r)) { out.push(Array.from(r.descriptor as Float32Array)); setMsg(tr(`تمام ${out.length}/3، ثبّت وشك`, `Good ${out.length}/3, hold still`)); await wait(900); }
            else await wait(250);
          }
        } else {
          setMsg(tr('بصّ للكاميرا', 'Look at the camera'));
          const t0 = Date.now();
          let turned = false;
          let ok = false;
          while (Date.now() - t0 < 45000 && !cancelled.current) {
            const r = await detect();
            if (!r) { await wait(200); continue; }
            const y = yaw(r);
            if (!turned) {
              if (frontal(r)) setMsg(tr('لف راسك ناحية اليمين شوية', 'Turn your head slightly to the right'));
              if (y < 0.33 || y > 0.67) { turned = true; setMsg(tr('تمام، دلوقتي بصّ للكاميرا تاني', 'Good, now look at the camera again')); }
            } else if (frontal(r)) {
              out.push(Array.from(r.descriptor as Float32Array));
              ok = true;
              break;
            }
            await wait(200);
          }
          if (!ok) out.length = 0;
        }
        if (cancelled.current) return;
        stream?.getTracks().forEach((t) => t.stop());
        if (out.length === 0) onDone(null, tr('ماقدرناش نتحقق من الوجه، حاول تاني في إضاءة أحسن', 'We could not verify your face, try again in better light'));
        else onDone(out);
      } catch (e: any) {
        stream?.getTracks().forEach((t) => t.stop());
        const denied = e?.name === 'NotAllowedError' || e?.name === 'NotFoundError';
        onDone(null, denied ? tr('لازم تسمح للتطبيق باستخدام الكاميرا', 'You must allow the app to use the camera') : tr('تعذر تشغيل الكاميرا أو تحميل التحقق. اتأكد من النت وحاول تاني', 'Could not start the camera or load the check. Check your internet and try again'));
      }
    })();
    return () => { cancelled.current = true; stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4" dir="rtl">
      <div className="w-full max-w-sm rounded-2xl bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">{mode === 'enroll' ? tr('تسجيل الوجه', 'Register face') : tr('التحقق بالوجه', 'Face check')}</h3>
          <button onClick={() => { cancelled.current = true; onDone(null); }} className="rounded-md p-1 hover:bg-muted" aria-label={tr('إغلاق', 'Close')}><X className="h-4 w-4" /></button>
        </div>
        <div className="relative mx-auto aspect-square w-full overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
          {busy && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-white" /></div>}
        </div>
        <p className="mt-3 text-center text-sm text-muted-foreground">{msg}</p>
      </div>
    </div>
  );
}
