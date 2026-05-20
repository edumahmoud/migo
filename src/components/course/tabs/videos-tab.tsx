'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  FileVideo,
  X,
  Loader2,
  Trash2,
  ArrowRight,
  Upload,
  MessageSquare,
  MessageSquareOff,
  Pencil,
  Send,
  User,
  Clock,
  HardDrive,
  Calendar,
  ChevronLeft,
  Pause,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useVideoUploadStore } from '@/stores/video-upload-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { formatNameWithTitle } from '@/components/shared/user-avatar';
import type { UserProfile, Subject, SubjectVideo, VideoComment } from '@/lib/types';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface VideosTabProps {
  profile: UserProfile;
  role: 'teacher' | 'student';
  subjectId: string;
  subject: Subject;
  teacherName: string;
}

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatTimeAgo(dateStr: string): string {
  try {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'الآن';
    if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
    if (diffHour < 24) return `منذ ${diffHour} ساعة`;
    if (diffDay < 7) return `منذ ${diffDay} يوم`;
    return formatDate(dateStr);
  } catch {
    return dateStr;
  }
}

function formatDuration(seconds: number | undefined | null): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// -------------------------------------------------------
// Extended video type with uploader info
// -------------------------------------------------------
interface SubjectVideoWithUploader extends SubjectVideo {
  uploader_name?: string;
  comment_count?: number;
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function VideosTab({ profile, role, subjectId }: VideosTabProps) {
  // ─── Video list state ───
  const [videos, setVideos] = useState<SubjectVideoWithUploader[]>([]);
  const [loading, setLoading] = useState(true);

  // ─── Video player state ───
  const [selectedVideo, setSelectedVideo] = useState<SubjectVideoWithUploader | null>(null);
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  // ─── Upload state ───
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Global upload store ───
  const { tasks: uploadTasks, addTask, startUpload, cancelTask, pauseTask, resumeTask, removeTask, clearCompleted } = useVideoUploadStore();
  const activeUploads = uploadTasks.filter((t) => t.subjectId === subjectId && (t.status === 'uploading' || t.status === 'saving' || t.status === 'paused'));
  const hasActiveUploads = activeUploads.length > 0;

  // ─── Edit state ───
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCommentsEnabled, setEditCommentsEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  // ─── Delete state ───
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ─── Delete comment confirmation ───
  const [confirmDeleteCommentId, setConfirmDeleteCommentId] = useState<string | null>(null);

  // -------------------------------------------------------
  // Fetch videos with uploader names and comment counts
  // -------------------------------------------------------
  const fetchVideos = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('subject_videos')
        .select('*')
        .eq('subject_id', subjectId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching videos:', error);
      } else if (data && data.length > 0) {
        // Fetch uploader profiles
        const uploaderIds = [...new Set(data.map((v: SubjectVideo) => v.uploaded_by))];
        const uploaderMap = new Map<
          string,
          { name: string; title_id?: string | null; gender?: string | null; role?: string | null }
        >();

        const { data: uploaders } = await supabase
          .from('users')
          .select('id, name, title_id, gender, role')
          .in('id', uploaderIds);

        if (uploaders) {
          for (const u of uploaders as {
            id: string;
            name: string;
            title_id?: string | null;
            gender?: string | null;
            role?: string | null;
          }[]) {
            uploaderMap.set(u.id, u);
          }
        }

        // Fetch comment counts
        const videoIds = data.map((v: SubjectVideo) => v.id);
        const commentCountMap = new Map<string, number>();

        const { data: commentCounts } = await supabase
          .from('video_comments')
          .select('video_id')
          .in('video_id', videoIds);

        if (commentCounts) {
          for (const c of commentCounts as { video_id: string }[]) {
            commentCountMap.set(c.video_id, (commentCountMap.get(c.video_id) || 0) + 1);
          }
        }

        const videosWithUploaders: SubjectVideoWithUploader[] = (data as SubjectVideo[]).map((v) => {
          const uploader = uploaderMap.get(v.uploaded_by);
          return {
            ...v,
            uploader_name: uploader
              ? formatNameWithTitle(uploader.name, uploader.role, uploader.title_id, uploader.gender)
              : 'مستخدم',
            comment_count: commentCountMap.get(v.id) || 0,
          };
        });

        setVideos(videosWithUploaders);

        // Update selectedVideo if it's in the list
        if (selectedVideo) {
          const updated = videosWithUploaders.find((v) => v.id === selectedVideo.id);
          if (updated) {
            setSelectedVideo(updated);
          }
        }
      } else {
        setVideos([]);
      }
    } catch (err) {
      console.error('Fetch videos error:', err);
    } finally {
      setLoading(false);
    }
  }, [subjectId, selectedVideo]);

  useEffect(() => {
    fetchVideos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId]);

  // -------------------------------------------------------
  // Real-time subscription for videos
  // -------------------------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel(`subject-videos-${subjectId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'subject_videos', filter: `subject_id=eq.${subjectId}` },
        () => fetchVideos(false)
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'subject_videos', filter: `subject_id=eq.${subjectId}` },
        () => fetchVideos(false)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'subject_videos', filter: `subject_id=eq.${subjectId}` },
        () => fetchVideos(false)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [subjectId, fetchVideos]);

  // -------------------------------------------------------
  // Fetch comments for a video
  // -------------------------------------------------------
  const fetchComments = useCallback(async (videoId: string) => {
    setCommentsLoading(true);
    try {
      const { data, error } = await supabase
        .from('video_comments')
        .select('*')
        .eq('video_id', videoId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching comments:', error);
      } else if (data && data.length > 0) {
        // Fetch user profiles for comments
        const userIds = [...new Set(data.map((c: VideoComment) => c.user_id))];
        const userMap = new Map<
          string,
          { name: string; title_id?: string | null; gender?: string | null; role?: string | null }
        >();

        const { data: users } = await supabase
          .from('users')
          .select('id, name, title_id, gender, role')
          .in('id', userIds);

        if (users) {
          for (const u of users as {
            id: string;
            name: string;
            title_id?: string | null;
            gender?: string | null;
            role?: string | null;
          }[]) {
            userMap.set(u.id, u);
          }
        }

        const commentsWithNames: VideoComment[] = (data as VideoComment[]).map((c) => {
          const user = userMap.get(c.user_id);
          return {
            ...c,
            user_name: user
              ? formatNameWithTitle(user.name, user.role, user.title_id, user.gender)
              : 'مستخدم',
            user_role: user?.role ?? undefined,
            user_title_id: user?.title_id ?? undefined,
            user_gender: user?.gender ?? undefined,
          };
        });

        setComments(commentsWithNames);
      } else {
        setComments([]);
      }
    } catch (err) {
      console.error('Fetch comments error:', err);
    } finally {
      setCommentsLoading(false);
    }
  }, []);

  // -------------------------------------------------------
  // Real-time subscription for comments on selected video
  // -------------------------------------------------------
  useEffect(() => {
    if (!selectedVideo) return;

    const channel = supabase
      .channel(`video-comments-${selectedVideo.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'video_comments', filter: `video_id=eq.${selectedVideo.id}` },
        () => fetchComments(selectedVideo.id)
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'video_comments', filter: `video_id=eq.${selectedVideo.id}` },
        () => fetchComments(selectedVideo.id)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedVideo, fetchComments]);

  // -------------------------------------------------------
  // Select a video and open player view
  // -------------------------------------------------------
  const handleSelectVideo = (video: SubjectVideoWithUploader) => {
    setSelectedVideo(video);
    setNewComment('');
    fetchComments(video.id);
  };

  // -------------------------------------------------------
  // Go back to list view
  // -------------------------------------------------------
  const handleBackToList = () => {
    setSelectedVideo(null);
    setComments([]);
    setNewComment('');
  };

  // -------------------------------------------------------
  // Upload video (teacher only) — background via global store
  // -------------------------------------------------------
  const handleUpload = async () => {
    if (!videoFile || !title.trim()) return;

    // Add task to global store
    const taskId = addTask({
      id: '', // will be assigned by addTask
      subjectId,
      file: videoFile,
      title: title.trim(),
      description: description.trim(),
    });

    // Close modal immediately — upload continues in background
    setUploadModalOpen(false);
    resetUploadForm();

    // Start the actual upload (non-blocking)
    startUpload(taskId);
  };

  // -------------------------------------------------------
  // Reset upload form
  // -------------------------------------------------------
  const resetUploadForm = () => {
    setVideoFile(null);
    setTitle('');
    setDescription('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // -------------------------------------------------------
  // Open edit modal for a video
  // -------------------------------------------------------
  const openEditModal = (video: SubjectVideoWithUploader) => {
    setEditTitle(video.title);
    setEditDescription(video.description || '');
    setEditCommentsEnabled(video.comments_enabled);
    setEditModalOpen(true);
  };

  // -------------------------------------------------------
  // Save video edits (teacher only)
  // -------------------------------------------------------
  const handleSaveEdit = async () => {
    if (!selectedVideo || !editTitle.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('subject_videos')
        .update({
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          comments_enabled: editCommentsEnabled,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedVideo.id);

      if (error) {
        toast.error('فشل تحديث بيانات الفيديو');
      } else {
        toast.success('تم تحديث الفيديو بنجاح');
        setEditModalOpen(false);
        fetchVideos();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------
  // Delete video (teacher only)
  // -------------------------------------------------------
  const handleDeleteVideo = async (videoId: string) => {
    setDeletingId(videoId);
    try {
      const video = videos.find((v) => v.id === videoId);
      if (video) {
        // Delete from storage (video-files bucket for new uploads, fallback to user-files for legacy)
        const videoBucket = video.video_url.includes('/video-files/') ? 'video-files' : 'user-files';
        const storagePath = video.video_url.split(`/${videoBucket}/`)[1];
        if (storagePath) {
          await supabase.storage.from(videoBucket).remove([storagePath]);
        }
        // Delete thumbnail if exists
        if (video.thumbnail_url) {
          const thumbBucket = video.thumbnail_url.includes('/video-files/') ? 'video-files' : 'user-files';
          const thumbPath = video.thumbnail_url.split(`/${thumbBucket}/`)[1];
          if (thumbPath) {
            await supabase.storage.from(thumbBucket).remove([thumbPath]);
          }
        }
      }

      // Delete comments first
      await supabase.from('video_comments').delete().eq('video_id', videoId);

      // Delete video record
      const { error } = await supabase.from('subject_videos').delete().eq('id', videoId);

      if (error) {
        toast.error('حدث خطأ أثناء حذف الفيديو');
      } else {
        toast.success('تم حذف الفيديو');
        if (selectedVideo?.id === videoId) {
          setSelectedVideo(null);
          setComments([]);
        }
        fetchVideos();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  // -------------------------------------------------------
  // Toggle comments enabled (teacher only)
  // -------------------------------------------------------
  const handleToggleComments = async (video: SubjectVideoWithUploader) => {
    try {
      const newValue = !video.comments_enabled;
      const { error } = await supabase
        .from('subject_videos')
        .update({ comments_enabled: newValue, updated_at: new Date().toISOString() })
        .eq('id', video.id);

      if (error) {
        toast.error('حدث خطأ أثناء تغيير حالة التعليقات');
      } else {
        toast.success(newValue ? 'تم تفعيل التعليقات' : 'تم إيقاف التعليقات');
        fetchVideos();
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    }
  };

  // -------------------------------------------------------
  // Submit a comment
  // -------------------------------------------------------
  const handleSubmitComment = async () => {
    if (!selectedVideo || !newComment.trim()) return;
    setSubmittingComment(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      const { error } = await supabase.from('video_comments').insert({
        video_id: selectedVideo.id,
        user_id: userId,
        content: newComment.trim(),
      });

      if (error) {
        toast.error('فشل إرسال التعليق');
      } else {
        setNewComment('');
        fetchComments(selectedVideo.id);
      }
    } catch {
      toast.error('حدث خطأ أثناء إرسال التعليق');
    } finally {
      setSubmittingComment(false);
    }
  };

  // -------------------------------------------------------
  // Delete a comment
  // -------------------------------------------------------
  const handleDeleteComment = async (commentId: string) => {
    setDeletingCommentId(commentId);
    try {
      const { error } = await supabase.from('video_comments').delete().eq('id', commentId);

      if (error) {
        toast.error('فشل حذف التعليق');
      } else {
        toast.success('تم حذف التعليق');
        if (selectedVideo) {
          fetchComments(selectedVideo.id);
        }
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setDeletingCommentId(null);
      setConfirmDeleteCommentId(null);
    }
  };

  // -------------------------------------------------------
  // Render: Video Grid (list view)
  // -------------------------------------------------------
  const renderVideoGrid = () => (
    <>
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-foreground">الفيديوهات</h3>
          <p className="text-muted-foreground text-sm mt-1">{videos.length} فيديو</p>
        </div>
        {role === 'teacher' && (
          <Button
            onClick={() => setUploadModalOpen(true)}
            className="flex items-center gap-2 bg-sky-700 hover:bg-sky-800 text-white"
          >
            <Upload className="h-4 w-4" />
            رفع فيديو
          </Button>
        )}
      </motion.div>

      {/* Video cards */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300" />
        </div>
      ) : videos.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/30 dark:bg-sky-950/30 py-16"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/50 mb-4">
            <FileVideo className="h-8 w-8 text-sky-700 dark:text-sky-300" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">لا توجد فيديوهات</p>
          <p className="text-sm text-muted-foreground">لم يتم رفع فيديوهات بعد</p>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map((video) => (
            <motion.div key={video.id} variants={itemVariants}>
              <Card
                className="group cursor-pointer overflow-hidden hover:shadow-lg transition-all border-border/60"
                onClick={() => handleSelectVideo(video)}
              >
                <CardContent className="p-0">
                  {/* Thumbnail area */}
                  <div className="relative aspect-video bg-gradient-to-br from-sky-100 to-sky-200 dark:from-sky-900/40 dark:to-sky-800/40 overflow-hidden">
                    {video.thumbnail_url ? (
                      <img
                        src={video.thumbnail_url}
                        alt={video.title}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <FileVideo className="h-12 w-12 text-sky-500 dark:text-sky-400 opacity-60" />
                      </div>
                    )}
                    {/* Play overlay */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                        <Play className="h-6 w-6 text-white fill-white" />
                      </div>
                    </div>
                    {/* Duration badge */}
                    {video.duration && (
                      <div className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                        {formatDuration(video.duration)}
                      </div>
                    )}
                  </div>

                  {/* Video info */}
                  <div className="p-4 space-y-2">
                    <h4 className="text-sm font-semibold text-foreground line-clamp-2 leading-relaxed">
                      {video.title}
                    </h4>
                    {video.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{video.description}</p>
                    )}
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {video.uploader_name}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(video.created_at)}
                      </span>
                      {video.comment_count !== undefined && video.comment_count > 0 && (
                        <span className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          {video.comment_count}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}
    </>
  );

  // -------------------------------------------------------
  // Render: Video Player View
  // -------------------------------------------------------
  const renderVideoPlayer = () => {
    if (!selectedVideo) return null;

    const isTeacher = role === 'teacher';

    return (
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
        {/* Back button */}
        <button
          onClick={handleBackToList}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          العودة
        </button>

        {/* Video player */}
        <div className="overflow-hidden rounded-xl border bg-black">
          <video
            key={selectedVideo.video_url}
            controls
            autoPlay
            className="w-full max-h-[70vh] aspect-video"
            poster={selectedVideo.thumbnail_url || undefined}
          >
            <source src={selectedVideo.video_url} type={selectedVideo.video_type} />
            متصفحك لا يدعم تشغيل الفيديو.
          </video>
        </div>

        {/* Video info */}
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-foreground">{selectedVideo.title}</h2>
          {selectedVideo.description && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedVideo.description}</p>
          )}
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />
              {selectedVideo.uploader_name}
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {formatDate(selectedVideo.created_at)}
            </span>
            <span className="flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5" />
              {formatFileSize(selectedVideo.video_size)}
            </span>
            {selectedVideo.duration && (
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {formatDuration(selectedVideo.duration)}
              </span>
            )}
          </div>
        </div>

        {/* Teacher actions */}
        {isTeacher && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openEditModal(selectedVideo)}
              className="flex items-center gap-1.5"
            >
              <Pencil className="h-3.5 w-3.5" />
              تعديل
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleToggleComments(selectedVideo)}
              className="flex items-center gap-1.5"
            >
              {selectedVideo.comments_enabled ? (
                <>
                  <MessageSquareOff className="h-3.5 w-3.5" />
                  إيقاف التعليقات
                </>
              ) : (
                <>
                  <MessageSquare className="h-3.5 w-3.5" />
                  تفعيل التعليقات
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDeleteId(selectedVideo.id)}
              className="flex items-center gap-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30 border-rose-200 dark:border-rose-800"
            >
              <Trash2 className="h-3.5 w-3.5" />
              حذف
            </Button>
          </div>
        )}

        {/* Comments section */}
        {selectedVideo.comments_enabled && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-sky-700 dark:text-sky-300" />
              <h3 className="text-base font-bold text-foreground">التعليقات</h3>
              {comments.length > 0 && (
                <span className="rounded-full bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200 px-2 py-0.5 text-[11px] font-medium">
                  {comments.length}
                </span>
              )}
            </div>

            {/* Add comment form */}
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="اكتب تعليقك..."
                  rows={2}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40 resize-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmitComment();
                    }
                  }}
                />
              </div>
              <Button
                onClick={handleSubmitComment}
                disabled={!newComment.trim() || submittingComment}
                size="icon"
                className="mt-1 shrink-0 bg-sky-700 hover:bg-sky-800 text-white"
              >
                {submittingComment ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* Comments list */}
            {commentsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-sky-700 dark:text-sky-300" />
              </div>
            ) : comments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">لا توجد تعليقات بعد</p>
                <p className="text-xs text-muted-foreground/70">كن أول من يعلّق على هذا الفيديو</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
                <AnimatePresence>
                  {comments.map((comment) => {
                    const canDelete =
                      isTeacher || comment.user_id === profile.id;

                    return (
                      <motion.div
                        key={comment.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className="rounded-lg border bg-card p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-foreground">
                                {comment.user_name || 'مستخدم'}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {formatTimeAgo(comment.created_at)}
                              </span>
                            </div>
                            <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
                              {comment.content}
                            </p>
                          </div>
                          {canDelete && (
                            <button
                              onClick={() => setConfirmDeleteCommentId(comment.id)}
                              disabled={deletingCommentId === comment.id}
                              className="shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors p-1 disabled:opacity-60"
                              title="حذف التعليق"
                            >
                              {deletingCommentId === comment.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
        )}

        {/* Comments disabled notice (teacher sees it too) */}
        {!selectedVideo.comments_enabled && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-muted-foreground/20 py-8 text-center">
            <MessageSquareOff className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">التعليقات معطّلة على هذا الفيديو</p>
            {isTeacher && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleToggleComments(selectedVideo)}
                className="mt-3 flex items-center gap-1.5"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                تفعيل التعليقات
              </Button>
            )}
          </div>
        )}
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
      dir="rtl"
    >
      <AnimatePresence mode="wait">
        {selectedVideo ? (
          <motion.div key="player" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {renderVideoPlayer()}
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {renderVideoGrid()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Upload Modal ─── */}
      <AnimatePresence>
        {uploadModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => {
              setUploadModalOpen(false);
              resetUploadForm();
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border bg-background shadow-xl"
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b p-5">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Upload className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                  رفع فيديو
                </h3>
                <button
                  onClick={() => {
                    setUploadModalOpen(false);
                    resetUploadForm();
                  }}
                  className="flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Title */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    عنوان الفيديو <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="أدخل عنوان الفيديو"
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">الوصف</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="أدخل وصف الفيديو (اختياري)"
                    rows={3}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40 resize-none"
                  />
                </div>

                {/* File picker */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    ملف الفيديو <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*"
                      onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                      className="w-full rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-3 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-sky-700 file:text-white file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-sky-800 file:cursor-pointer file:transition-colors"
                    />
                  </div>
                  {videoFile && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg border bg-muted/30 p-2.5">
                      <FileVideo className="h-4 w-4 text-sky-700 dark:text-sky-300 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">{videoFile.name}</p>
                        <p className="text-[11px] text-muted-foreground">{formatFileSize(videoFile.size)}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Info note about background upload */}
                {videoFile && (
                  <div className="flex items-start gap-2 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/30 p-2.5">
                    <Upload className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-sky-700 dark:text-sky-300">سيستمر الرفع في الخلفية ويمكنك التنقل في التطبيق أثناء ذلك</p>
                  </div>
                )}

                {/* Submit */}
                <Button
                  onClick={handleUpload}
                  disabled={!videoFile || !title.trim()}
                  className="flex items-center justify-center gap-2 w-full bg-sky-700 hover:bg-sky-800 text-white"
                >
                  <Upload className="h-4 w-4" />
                  رفع الفيديو
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Edit Video Modal ─── */}
      <AnimatePresence>
        {editModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => {
              if (!saving) setEditModalOpen(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10, pointerEvents: 'none' as const }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border bg-background shadow-xl"
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b p-5">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Pencil className="h-5 w-5 text-sky-700 dark:text-sky-300" />
                  تعديل الفيديو
                </h3>
                <button
                  onClick={() => {
                    if (!saving) setEditModalOpen(false);
                  }}
                  className="flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Title */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    عنوان الفيديو <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="أدخل عنوان الفيديو"
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    disabled={saving}
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">الوصف</label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="أدخل وصف الفيديو (اختياري)"
                    rows={3}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40 resize-none"
                    disabled={saving}
                  />
                </div>

                {/* Toggle comments */}
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    {editCommentsEnabled ? (
                      <MessageSquare className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                    ) : (
                      <MessageSquareOff className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-foreground">التعليقات</p>
                      <p className="text-[11px] text-muted-foreground">
                        {editCommentsEnabled ? 'التعليقات مفعّلة' : 'التعليقات معطّلة'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setEditCommentsEnabled(!editCommentsEnabled)}
                    disabled={saving}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 ${
                      editCommentsEnabled ? 'bg-sky-700' : 'bg-muted'
                    } disabled:opacity-60`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform ${
                        editCommentsEnabled ? '-translate-x-5' : '-translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                {/* Save */}
                <Button
                  onClick={handleSaveEdit}
                  disabled={!editTitle.trim() || saving}
                  className="flex items-center justify-center gap-2 w-full bg-sky-700 hover:bg-sky-800 text-white"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      جاري الحفظ...
                    </>
                  ) : (
                    <>
                      <Pencil className="h-4 w-4" />
                      حفظ التعديلات
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Delete Video Confirmation ─── */}
      <AlertDialog
        open={!!confirmDeleteId}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الفيديو</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذا الفيديو؟ سيتم حذف جميع التعليقات أيضاً. لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 justify-end">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmDeleteId) handleDeleteVideo(confirmDeleteId);
              }}
              disabled={!!deletingId}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {deletingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Delete Comment Confirmation ─── */}
      <AlertDialog
        open={!!confirmDeleteCommentId}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteCommentId(null);
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف التعليق</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذا التعليق؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 justify-end">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmDeleteCommentId) handleDeleteComment(confirmDeleteCommentId);
              }}
              disabled={!!deletingCommentId}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {deletingCommentId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Background Upload Progress Panel ─── */}
      {uploadTasks.filter((t) => t.subjectId === subjectId && t.status !== 'cancelled').length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="rounded-xl border bg-card shadow-lg overflow-hidden"
          dir="rtl"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-sky-700 dark:text-sky-300" />
              <span className="text-sm font-medium text-foreground">
                رفع في الخلفية
                {hasActiveUploads && (
                  <span className="mr-1.5 inline-flex items-center">
                    <Loader2 className="h-3 w-3 animate-spin text-sky-600" />
                  </span>
                )}
              </span>
            </div>
            {uploadTasks.some((t) => t.subjectId === subjectId && (t.status === 'done' || t.status === 'error')) && (
              <button
                onClick={clearCompleted}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                مسح المكتمل
              </button>
            )}
          </div>
          <div className="divide-y max-h-48 overflow-y-auto custom-scrollbar">
            {uploadTasks
              .filter((t) => t.subjectId === subjectId && t.status !== 'cancelled')
              .map((task) => (
                <div key={task.id} className="px-4 py-2.5 flex items-center gap-3">
                  {/* Status icon */}
                  {task.status === 'uploading' || task.status === 'saving' ? (
                    <Loader2 className="h-4 w-4 animate-spin text-sky-600 shrink-0" />
                  ) : task.status === 'done' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground truncate">{task.title}</p>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {task.status === 'uploading' ? `${task.progress}%` :
                         task.status === 'paused' ? `متوقف ${task.progress}%` :
                         task.status === 'saving' ? 'حفظ...' :
                         task.status === 'done' ? 'تم' :
                         task.status === 'error' ? 'فشل' : ''}
                      </span>
                    </div>
                    {(task.status === 'uploading' || task.status === 'saving' || task.status === 'paused') && (
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            task.status === 'paused'
                              ? 'bg-amber-500 dark:bg-amber-400'
                              : task.status === 'saving'
                              ? 'bg-amber-500 dark:bg-amber-400'
                              : 'bg-sky-700 dark:bg-sky-500'
                          }`}
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                    )}
                    {task.status === 'error' && task.error && (
                      <p className="text-[11px] text-rose-500 mt-0.5 truncate">{task.error}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    {task.status === 'uploading' && (
                      <button
                        onClick={() => pauseTask(task.id)}
                        className="rounded-md p-1 text-muted-foreground hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                        title="إيقاف مؤقت"
                      >
                        <Pause className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {task.status === 'paused' && (
                      <button
                        onClick={() => resumeTask(task.id)}
                        className="rounded-md p-1 text-muted-foreground hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950/30 transition-colors"
                        title="استئناف"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {(task.status === 'uploading' || task.status === 'saving' || task.status === 'paused') && (
                      <button
                        onClick={() => cancelTask(task.id)}
                        className="rounded-md p-1 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                        title="إلغاء الرفع"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {task.status === 'error' && (
                      <button
                        onClick={() => removeTask(task.id)}
                        className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="إزالة"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
