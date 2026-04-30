'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Building2,
  School,
  Landmark,
  MapPin,
  Phone,
  Mail,
  Globe,
  Calendar,
  FileText,
  Loader2,
  Save,
  ImagePlus,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useInstitutionStore } from '@/stores/institution-store';
import type { UserProfile } from '@/lib/types';

// ─── Types ───

type InstitutionType = 'center' | 'school' | 'university';

interface InstitutionData {
  id?: string;
  name: string;
  name_en?: string | null;
  type: InstitutionType;
  logo_url?: string | null;
  tagline?: string | null;
  country?: string | null;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  timezone?: string | null;
  academic_year?: string | null;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface InstitutionSectionProps {
  profile: UserProfile;
}

// ─── Animation variants ───

const sectionVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.3, ease: 'easeOut' },
  }),
};

// ─── Component ───

export default function InstitutionSection({ profile }: InstitutionSectionProps) {
  // ─── State ───
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [institution, setInstitution] = useState<InstitutionData>({
    name: '',
    type: 'center',
  });
  const [originalData, setOriginalData] = useState<string>('');

  // ─── Auto-migrate tagline column ───
  const [taglineMigrationStatus, setTaglineMigrationStatus] = useState<'checking' | 'migrated' | 'pending' | 'error'>('checking');

  useEffect(() => {
    // Check if the tagline column exists in the database
    const checkMigration = async () => {
      try {
        const res = await fetch('/api/migrate/tagline-column');
        const data = await res.json();
        if (data.status === 'migrated') {
          setTaglineMigrationStatus('migrated');
        } else if (data.status === 'pending') {
          setTaglineMigrationStatus('pending');
        } else {
          setTaglineMigrationStatus('error');
        }
      } catch {
        setTaglineMigrationStatus('error');
      }
    };
    checkMigration();
  }, []);

  // ─── Fetch institution data ───
  const fetchInstitution = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/setup');
      if (res.ok) {
        const data = await res.json();
        if (data.institution) {
          const inst = data.institution as InstitutionData;
          setInstitution(inst);
          setOriginalData(JSON.stringify(inst));
          // Update the global institution store so header/auth pages reflect changes
          useInstitutionStore.getState().setInstitution(inst);
        }
      }
    } catch {
      // Silent error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstitution();
  }, [fetchInstitution]);

  // ─── Track changes ───
  useEffect(() => {
    setHasChanges(JSON.stringify(institution) !== originalData);
  }, [institution, originalData]);

  // ─── Update field helper ───
  const updateField = (field: keyof InstitutionData, value: string | null) => {
    setInstitution((prev) => ({ ...prev, [field]: value }));
  };

  // ─── Logo upload ───
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('يرجى اختيار ملف صورة فقط');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('حجم الشعار يجب أن يكون أقل من 2 ميجابايت');
      return;
    }

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      // Use the dedicated institution-logo endpoint instead of /api/avatar
      // This avoids overwriting the user's avatar_url in the database
      const res = await fetch('/api/institution-logo', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.success && data.url) {
        updateField('logo_url', data.url);
        toast.success('تم رفع الشعار بنجاح');
      } else {
        toast.error(data.error || 'حدث خطأ أثناء رفع الشعار');
      }
    } catch {
      toast.error('حدث خطأ أثناء رفع الشعار');
    } finally {
      setUploadingLogo(false);
    }
  };

  // ─── Save handler ───
  const handleSave = async () => {
    if (!institution.name.trim()) {
      toast.error('يرجى إدخال اسم المؤسسة');
      return;
    }
    if (!institution.type) {
      toast.error('يرجى اختيار نوع المؤسسة');
      return;
    }

    setSaving(true);
    try {
      // Get auth token for the request
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: 'save_institution',
          name: institution.name.trim(),
          nameEn: institution.name_en?.trim() || null,
          type: institution.type,
          logo_url: institution.logo_url || null,
          tagline: institution.tagline?.trim() || null,
          country: institution.country?.trim() || null,
          city: institution.city?.trim() || null,
          address: institution.address?.trim() || null,
          phone: institution.phone?.trim() || null,
          email: institution.email?.trim() || null,
          website: institution.website?.trim() || null,
          timezone: institution.timezone?.trim() || null,
          academic_year: institution.academic_year?.trim() || null,
          description: institution.description?.trim() || null,
        }),
      });

      const result = await res.json();
      if (!res.ok || result.error) {
        toast.error(result.error || 'فشل في حفظ بيانات المؤسسة');
        return;
      }

      toast.success('تم حفظ بيانات المؤسسة بنجاح');
      // Refresh data
      await fetchInstitution();
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  // ─── Loading state ───
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <span className="text-sm text-muted-foreground">جاري تحميل بيانات المؤسسة...</span>
        </div>
      </div>
    );
  }

  const institutionTypes: { key: InstitutionType; label: string; icon: React.ReactNode }[] = [
    { key: 'center', label: 'سنتر تعليمي', icon: <Building2 className="h-5 w-5" /> },
    { key: 'school', label: 'مدرسة', icon: <School className="h-5 w-5" /> },
    { key: 'university', label: 'جامعة', icon: <Landmark className="h-5 w-5" /> },
  ];

  const typeLabelMap: Record<InstitutionType, string> = {
    center: 'سنتر تعليمي',
    school: 'مدرسة',
    university: 'جامعة',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="h-6 w-6 text-emerald-600" />
            بيانات المؤسسة
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">إدارة بيانات وإعدادات المؤسسة التعليمية</p>

          {/* Migration banner for tagline column */}
          {taglineMigrationStatus === 'pending' && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-amber-800">تحديث قاعدة البيانات مطلوب</p>
                <p className="text-[10px] text-amber-700 mt-0.5">
                  لتتمكن من استخدام حقل "الوصف المختصر"، يرجى تنفيذ SQL التالي في محرر SQL بلوحة تحكم Supabase:
                </p>
                <code className="mt-1 block text-[10px] bg-amber-100/80 rounded p-1.5 font-mono text-amber-900 select-all">
                  ALTER TABLE institution_settings ADD COLUMN IF NOT EXISTS tagline TEXT;
                </code>
              </div>
            </div>
          )}
        </div>
        {institution.name && (
          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">
            {typeLabelMap[institution.type]}
          </Badge>
        )}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ─── Left column: Logo + Type ─── */}
        <div className="space-y-4">
          {/* Logo Card */}
          <motion.div
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={0}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/30">
              <ImagePlus className="h-4 w-4 text-emerald-600" />
              <h3 className="font-semibold text-foreground text-sm">شعار المؤسسة</h3>
            </div>
            <div className="p-4 flex flex-col items-center gap-4">
              <div className="relative group">
                {institution.logo_url ? (
                  <img
                    src={institution.logo_url}
                    alt="شعار المؤسسة"
                    className="h-28 w-28 rounded-2xl object-cover border-2 border-emerald-200 shadow-sm"
                  />
                ) : (
                  <div className="h-28 w-28 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-dashed border-emerald-300 flex flex-col items-center justify-center gap-2">
                    <Building2 className="h-10 w-10 text-emerald-400" />
                    <span className="text-[10px] text-emerald-500">لا يوجد شعار</span>
                  </div>
                )}
                {uploadingLogo && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40">
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  onClick={() => document.getElementById('institution-logo-input')?.click()}
                  disabled={uploadingLogo}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  {institution.logo_url ? 'تغيير الشعار' : 'إضافة شعار'}
                </Button>
                {institution.logo_url && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                    onClick={() => updateField('logo_url', null)}
                    disabled={uploadingLogo}
                  >
                    إزالة
                  </Button>
                )}
              </div>
              <input
                id="institution-logo-input"
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
                disabled={uploadingLogo}
              />
              <p className="text-[10px] text-muted-foreground text-center">PNG, JPG حتى 2MB</p>
            </div>
          </motion.div>

          {/* Institution Type Card */}
          <motion.div
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={1}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/30">
              <School className="h-4 w-4 text-emerald-600" />
              <h3 className="font-semibold text-foreground text-sm">نوع المؤسسة</h3>
            </div>
            <div className="p-4 space-y-2">
              {institutionTypes.map(({ key, label, icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => updateField('type', key)}
                  className={`w-full flex items-center gap-3 rounded-xl p-3 border-2 transition-all duration-200 ${
                    institution.type === key
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm'
                      : 'border-border text-muted-foreground hover:border-emerald-200 hover:bg-emerald-50/50'
                  }`}
                  disabled={saving}
                >
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                    institution.type === key ? 'bg-emerald-100' : 'bg-muted/50'
                  }`}>
                    {icon}
                  </div>
                  <span className="text-sm font-medium">{label}</span>
                  {institution.type === key && (
                    <CheckCircle2 className="h-4 w-4 mr-auto text-emerald-500" />
                  )}
                </button>
              ))}
            </div>
          </motion.div>

          {/* Quick info card */}
          {institution.name && (
            <motion.div
              className="rounded-xl border bg-emerald-50/50 shadow-sm overflow-hidden"
              variants={sectionVariants}
              initial="hidden"
              animate="visible"
              custom={2}
            >
              <div className="p-4 space-y-2">
                <div className="flex items-center gap-2 mb-3">
                  <AlertCircle className="h-4 w-4 text-emerald-600" />
                  <span className="text-xs font-medium text-emerald-700">ملخص المؤسسة</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">الاسم</span>
                    <span className="font-medium text-foreground">{institution.name}</span>
                  </div>
                  {institution.country && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">الدولة</span>
                      <span className="font-medium text-foreground">{institution.country}</span>
                    </div>
                  )}
                  {institution.city && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">المدينة</span>
                      <span className="font-medium text-foreground">{institution.city}</span>
                    </div>
                  )}
                  {institution.academic_year && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">العام الدراسي</span>
                      <span className="font-medium text-foreground">{institution.academic_year}</span>
                    </div>
                  )}
                  {institution.updated_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">آخر تحديث</span>
                      <span className="font-medium text-foreground">
                        {new Date(institution.updated_at).toLocaleDateString('ar-SA')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* ─── Right column: Details ─── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Basic Info Card */}
          <motion.div
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={3}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/30">
              <FileText className="h-4 w-4 text-emerald-600" />
              <h3 className="font-semibold text-foreground text-sm">المعلومات الأساسية</h3>
            </div>
            <div className="p-4 space-y-4">
              {/* Institution Name (Arabic) */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  اسم المؤسسة <span className="text-red-400">*</span>
                </Label>
                <div className="relative">
                  <Input
                    type="text"
                    placeholder={`اسم ال${institution.type === 'center' ? 'سنتر' : institution.type === 'school' ? 'مدرسة' : 'الجامعة'}`}
                    value={institution.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    className="h-10 text-sm pe-10"
                    disabled={saving}
                  />
                  <Building2 className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              {/* Institution Name (English) */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">اسم المؤسسة بالإنجليزية</Label>
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Institution Name"
                    value={institution.name_en || ''}
                    onChange={(e) => updateField('name_en', e.target.value)}
                    className="h-10 text-sm ps-10"
                    dir="ltr"
                    disabled={saving}
                  />
                  <FileText className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              {/* Tagline */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">الوصف المختصر</Label>
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="مثال: منصة تعليم ذكية"
                    value={institution.tagline || ''}
                    onChange={(e) => updateField('tagline', e.target.value)}
                    className="h-10 text-sm pe-10"
                    disabled={saving}
                    maxLength={200}
                  />
                  <FileText className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
                <p className="text-[10px] text-muted-foreground">عبارة وصفية تظهر في عنوان المتصفح بجانب اسم المؤسسة</p>
              </div>

              {/* Country + City */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">الدولة</Label>
                  <div className="relative">
                    <Input
                      type="text"
                      placeholder="الدولة"
                      value={institution.country || ''}
                      onChange={(e) => updateField('country', e.target.value)}
                      className="h-10 text-sm pe-10"
                      disabled={saving}
                    />
                    <MapPin className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">المدينة</Label>
                  <Input
                    type="text"
                    placeholder="المدينة"
                    value={institution.city || ''}
                    onChange={(e) => updateField('city', e.target.value)}
                    className="h-10 text-sm"
                    disabled={saving}
                  />
                </div>
              </div>

              {/* Address */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">العنوان</Label>
                <Input
                  type="text"
                  placeholder="العنوان التفصيلي"
                  value={institution.address || ''}
                  onChange={(e) => updateField('address', e.target.value)}
                  className="h-10 text-sm"
                  disabled={saving}
                />
              </div>
            </div>
          </motion.div>

          {/* Contact Info Card */}
          <motion.div
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={4}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/30">
              <Phone className="h-4 w-4 text-emerald-600" />
              <h3 className="font-semibold text-foreground text-sm">بيانات التواصل</h3>
            </div>
            <div className="p-4 space-y-4">
              {/* Phone + Email */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">رقم الهاتف</Label>
                  <div className="relative">
                    <Input
                      type="tel"
                      placeholder="+966 5x xxx xxxx"
                      value={institution.phone || ''}
                      onChange={(e) => updateField('phone', e.target.value)}
                      className="h-10 text-sm ps-10"
                      dir="ltr"
                      disabled={saving}
                    />
                    <Phone className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">البريد الإلكتروني</Label>
                  <div className="relative">
                    <Input
                      type="email"
                      placeholder="info@institution.com"
                      value={institution.email || ''}
                      onChange={(e) => updateField('email', e.target.value)}
                      className="h-10 text-sm ps-10"
                      dir="ltr"
                      disabled={saving}
                    />
                    <Mail className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Website + Academic Year */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">الموقع الإلكتروني</Label>
                  <div className="relative">
                    <Input
                      type="url"
                      placeholder="www.institution.com"
                      value={institution.website || ''}
                      onChange={(e) => updateField('website', e.target.value)}
                      className="h-10 text-sm ps-10"
                      dir="ltr"
                      disabled={saving}
                    />
                    <Globe className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">العام الدراسي</Label>
                  <div className="relative">
                    <Input
                      type="text"
                      placeholder="2025/2026"
                      value={institution.academic_year || ''}
                      onChange={(e) => updateField('academic_year', e.target.value)}
                      className="h-10 text-sm ps-10"
                      dir="ltr"
                      disabled={saving}
                    />
                    <Calendar className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Timezone */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">المنطقة الزمنية</Label>
                <div className="relative">
                  <select
                    value={institution.timezone || 'Africa/Cairo'}
                    onChange={(e) => updateField('timezone', e.target.value)}
                    className="h-10 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 appearance-none"
                    disabled={saving}
                    dir="ltr"
                  >
                    <option value="Africa/Cairo">القاهرة (GMT+2)</option>
                    <option value="Asia/Riyadh">الرياض (GMT+3)</option>
                    <option value="Asia/Dubai">دبي (GMT+4)</option>
                    <option value="Asia/Kuwait">الكويت (GMT+3)</option>
                    <option value="Asia/Qatar">قطر (GMT+3)</option>
                    <option value="Asia/Bahrain">البحرين (GMT+3)</option>
                    <option value="Asia/Muscat">مسقط (GMT+4)</option>
                    <option value="Africa/Casablanca">الدار البيضاء (GMT+1)</option>
                    <option value="Africa/Tunis">تونس (GMT+1)</option>
                    <option value="Africa/Algiers">الجزائر (GMT+1)</option>
                    <option value="Asia/Amman">عمّان (GMT+3)</option>
                    <option value="Asia/Baghdad">بغداد (GMT+3)</option>
                    <option value="Asia/Damascus">دمشق (GMT+3)</option>
                    <option value="Asia/Beirut">بيروت (GMT+3)</option>
                    <option value="Asia/Jerusalem">القدس (GMT+3)</option>
                    <option value="Asia/Jeddah">جدة (GMT+3)</option>
                    <option value="Europe/Istanbul">إسطنبول (GMT+3)</option>
                    <option value="Europe/London">لندن (GMT+0)</option>
                    <option value="Europe/Paris">باريس (GMT+1)</option>
                    <option value="America/New_York">نيويورك (GMT-5)</option>
                    <option value="America/Chicago">شيكاغو (GMT-6)</option>
                    <option value="America/Denver">دنفر (GMT-7)</option>
                    <option value="America/Los_Angeles">لوس أنجلوس (GMT-8)</option>
                    <option value="Asia/Tokyo">طوكيو (GMT+9)</option>
                    <option value="Asia/Shanghai">شنغهاي (GMT+8)</option>
                    <option value="Asia/Kolkata">مومباي (GMT+5:30)</option>
                    <option value="Australia/Sydney">سيدني (GMT+11)</option>
                  </select>
                  <Globe className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>
          </motion.div>

          {/* Description Card */}
          <motion.div
            className="rounded-xl border bg-card shadow-sm overflow-hidden"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            custom={5}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/30">
              <FileText className="h-4 w-4 text-emerald-600" />
              <h3 className="font-semibold text-foreground text-sm">وصف المؤسسة</h3>
            </div>
            <div className="p-4">
              <textarea
                placeholder="نبذة مختصرة عن المؤسسة..."
                value={institution.description || ''}
                onChange={(e) => updateField('description', e.target.value)}
                className="w-full rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-emerald-400 focus:ring-emerald-400/20 px-3 py-2.5 text-sm resize-none h-24"
                disabled={saving}
              />
            </div>
          </motion.div>

          {/* Save Button */}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => fetchInstitution()}
              disabled={saving || loading}
              className="h-10"
            >
              تراجع عن التعديلات
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-10 min-w-[140px]"
            >
              {saving ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري الحفظ...
                </span>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  حفظ التعديلات
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
