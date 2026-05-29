'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  FileVideo,
  X,
  Loader2,
  Trash2,
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
  CheckCircle2,
  Eye,
  Image as ImageIcon,
  Flag,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useVideoUploadStore } from '@/stores/video-upload-store';
import { useAppStore } from '@/stores/app-store';
import ReportButton from '@/components/reports/report-button';
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
import { useTranslations } from '@/i18n/use-translations';

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
function formatDate(dateStr: string, locale: string = 'ar'): string {
  try {
    return new Date(dateStr).toLocaleDateString(locale === 'en' ? 'en-US' : 'ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatTimeAgo(dateStr: string, t: (key: string, params?: Record<string, string | number>) => string, locale: string = 'ar'): string {
  try {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return t('common.justNow');
    if (diffMin < 60) return t('common.minutesAgo', { n: diffMin });
    if (diffHour < 24) return t('common.hoursAgo', { n: diffHour });
    if (diffDay < 7) return t('common.daysAgo', { n: diffDay });
    return formatDate(dateStr, locale);
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
  const { t, direction, locale } = useTranslations();
  // ─── App store for persisted video ID ───
  const { selectedVideoId, setSelectedVideoId } = useAppStore();

  // ─── Video list state ───
  const [videos, setVideos] = useState<SubjectVideoWithUploader[]>([]);
  const [loading, setLoading] = useState(true);

  // ─── Video player state ───
  const [selectedVideo, setSelectedVideo] = useState<SubjectVideoWithUploader | null>(null);

  // ─── Track if we've attempted to restore video from persisted ID ───
  const [restoredFromStore, setRestoredFromStore] = useState(false);
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  // ─── Upload state ───
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  // ─── Playback speed state ───
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const videoRef = useRef<HTMLVideoElement>(null);

  // ─── Selected video ref (for fetchVideos without dep) ───
  const selectedVideoRef = useRef<SubjectVideoWithUploader | null>(null);

  // ─── Edit comment state ───
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentContent, setEditingCommentContent] = useState('');
  const [savingComment, setSavingComment] = useState(false);

  // ─── Global upload store ───
  const { tasks: uploadTasks, addTask, startUpload } = useVideoUploadStore();

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
              ? formatNameWithTitle(uploader.name, uploader.role, uploader.title_id, uploader.gender, t)
              : t('common.user'),
            comment_count: commentCountMap.get(v.id) || 0,
          };
        });

        // Preserve optimistic entries (uploads still in progress) while replacing DB entries
        setVideos((prev) => {
          const optimisticEntries = prev.filter((v) => v.id.startsWith('optimistic-'));
          return [...optimisticEntries, ...videosWithUploaders];
        });

        // Update selectedVideo if it's in the list
        const currentSelected = selectedVideoRef.current;
        if (currentSelected) {
          const updated = videosWithUploaders.find((v) => v.id === currentSelected.id);
          if (updated) {
            setSelectedVideo(updated);
          }
        }

        // Restore selected video from persisted ID (after page refresh)
        if (!restoredFromStore && selectedVideoId) {
          const restored = videosWithUploaders.find((v) => v.id === selectedVideoId);
          if (restored) {
            setSelectedVideo(restored);
            fetchComments(restored.id);
          } else {
            // Video no longer exists — clear persisted ID
            setSelectedVideoId(null);
          }
          setRestoredFromStore(true);
        } else if (!restoredFromStore) {
          setRestoredFromStore(true);
        }
      } else {
        // Preserve optimistic entries even when DB is empty
        setVideos((prev) => prev.filter((v) => v.id.startsWith('optimistic-')));
      }
    } catch (err) {
      console.error('Fetch videos error:', err);
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    fetchVideos();
     
  }, [subjectId]);

  // Sync selectedVideo to ref
  useEffect(() => { selectedVideoRef.current = selectedVideo; }, [selectedVideo]);

  // Sync playback speed to video element when it changes or video changes
  useEffect(() => {
    if (videoRef.current && playbackSpeed !== 1) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [selectedVideo, playbackSpeed]);

  // -------------------------------------------------------
  // Real-time subscription for videos — surgical updates
  // -------------------------------------------------------
  useEffect(() => {
    const fetchSingleVideo = async (videoId: string): Promise<SubjectVideoWithUploader | null> => {
      try {
        const { data, error } = await supabase
          .from('subject_videos')
          .select('*')
          .eq('id', videoId)
          .single();
        if (error || !data) return null;

        const video = data as SubjectVideo;
        const { data: uploader } = await supabase
          .from('users')
          .select('id, name, title_id, gender, role')
          .eq('id', video.uploaded_by)
          .single();

        const { count } = await supabase
          .from('video_comments')
          .select('*', { count: 'exact', head: true })
          .eq('video_id', video.id);

        return {
          ...video,
          uploader_name: uploader
            ? formatNameWithTitle(uploader.name, uploader.role, uploader.title_id, uploader.gender, t)
            : t('common.user'),
          comment_count: count || 0,
        };
      } catch {
        return null;
      }
    };

    const channel = supabase
      .channel(`subject-videos-${subjectId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'subject_videos', filter: `subject_id=eq.${subjectId}` },
        async (payload) => {
          const newVideo = payload.new as SubjectVideo;
          setVideos((prev) => {
            // Skip if already exists (avoid duplicate from optimistic + realtime)
            if (prev.some((v) => v.id === newVideo.id)) return prev;
            // Remove optimistic entry with matching title if present
            const withoutOptimistic = prev.filter(
              (v) => !(v.id.startsWith('optimistic-') && v.title === newVideo.title && v.video_size === newVideo.video_size)
            );
            // Add placeholder immediately, then enrich async
            return [newVideo as unknown as SubjectVideoWithUploader, ...withoutOptimistic];
          });
          // Enrich with uploader name and comment count
          try {
            const enriched = await fetchSingleVideo(newVideo.id);
            if (enriched) {
              setVideos((prev) => prev.map((v) => (v.id === newVideo.id ? enriched : v)));
            }
          } catch {
            // Keep the placeholder — don't lose the video
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'subject_videos', filter: `subject_id=eq.${subjectId}` },
        (payload) => {
          const deletedId = (payload.old as { id: string }).id;
          setVideos((prev) => prev.filter((v) => v.id !== deletedId));
          // Clear selectedVideo if it was deleted
          if (selectedVideoRef.current?.id === deletedId) {
            setSelectedVideo(null);
            setSelectedVideoId(null);
            setComments([]);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'subject_videos', filter: `subject_id=eq.${subjectId}` },
        async (payload) => {
          const updatedVideo = payload.new as SubjectVideo;
          // Enrich the updated video
          const enriched = await fetchSingleVideo(updatedVideo.id);
          if (enriched) {
            setVideos((prev) => prev.map((v) => (v.id === updatedVideo.id ? enriched : v)));
            // Update selectedVideo if it's the one that changed
            if (selectedVideoRef.current?.id === updatedVideo.id) {
              setSelectedVideo(enriched);
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[Realtime] subject-videos-${subjectId} subscribed`);
        } else if (status === 'CHANNEL_ERROR') {
          console.error(`[Realtime] subject-videos-${subjectId} error`);
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [subjectId]);

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
        .order('created_at', { ascending: false });

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
              ? formatNameWithTitle(user.name, user.role, user.title_id, user.gender, t)
              : t('common.user'),
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
  // Real-time subscription for comments on selected video — surgical updates
  // -------------------------------------------------------
  useEffect(() => {
    if (!selectedVideo) return;

    const fetchSingleComment = async (commentId: string): Promise<VideoComment | null> => {
      try {
        const { data, error } = await supabase
          .from('video_comments')
          .select('*')
          .eq('id', commentId)
          .single();
        if (error || !data) return null;

        const comment = data as VideoComment;
        const { data: user } = await supabase
          .from('users')
          .select('id, name, title_id, gender, role')
          .eq('id', comment.user_id)
          .single();

        return {
          ...comment,
          user_name: user
            ? formatNameWithTitle(user.name, user.role, user.title_id, user.gender, t)
            : t('common.user'),
          user_role: user?.role ?? undefined,
          user_title_id: user?.title_id ?? undefined,
          user_gender: user?.gender ?? undefined,
        };
      } catch {
        return null;
      }
    };

    const channel = supabase
      .channel(`video-comments-${selectedVideo.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'video_comments', filter: `video_id=eq.${selectedVideo.id}` },
        async (payload) => {
          const newComment = payload.new as VideoComment;
          // Skip if already exists
          setComments((prev) => {
            if (prev.some((c) => c.id === newComment.id)) return prev;
            // Add placeholder, then enrich async
            return [...prev, { ...newComment, user_name: t('common.user') }];
          });
          // Enrich with user profile
          const enriched = await fetchSingleComment(newComment.id);
          if (enriched) {
            setComments((prev) => prev.map((c) => (c.id === newComment.id ? enriched : c)));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'video_comments', filter: `video_id=eq.${selectedVideo.id}` },
        (payload) => {
          const deletedId = (payload.old as { id: string }).id;
          setComments((prev) => prev.filter((c) => c.id !== deletedId));
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'video_comments', filter: `video_id=eq.${selectedVideo.id}` },
        async (payload) => {
          const updatedComment = payload.new as VideoComment;
          // Update the comment in place immediately with all available data from Realtime payload
          setComments((prev) => prev.map((c) => {
            if (c.id !== updatedComment.id) return c;
            return {
              ...c,
              content: updatedComment.content,
              updated_at: updatedComment.updated_at,
              is_flagged: (updatedComment as any).is_flagged ?? c.is_flagged,
              flagged_at: (updatedComment as any).flagged_at ?? c.flagged_at,
              flagged_by: (updatedComment as any).flagged_by ?? c.flagged_by,
            };
          }));
          // Re-enrich in case flagged_by changed (async, non-blocking)
          try {
            const enriched = await fetchSingleComment(updatedComment.id);
            if (enriched) {
              setComments((prev) => prev.map((c) => (c.id === updatedComment.id ? enriched : c)));
            }
          } catch {
            // Keep the optimistic update — don't lose the comment
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedVideo]);

  // -------------------------------------------------------
  // Select a video and open player view
  // -------------------------------------------------------
  const handleSelectVideo = (video: SubjectVideoWithUploader) => {
    setSelectedVideo(video);
    setSelectedVideoId(video.id);
    setNewComment('');
    fetchComments(video.id);
  };

  // -------------------------------------------------------
  // Go back to list view
  // -------------------------------------------------------
  const handleBackToList = () => {
    setSelectedVideo(null);
    setSelectedVideoId(null);
    setComments([]);
    setNewComment('');
  };

  // -------------------------------------------------------
  // Upload video (teacher only) — background via global store
  // -------------------------------------------------------
  const handleUpload = async () => {
    if (!videoFiles.length || !title.trim()) return;

    const optimisticVideos: SubjectVideoWithUploader[] = [];

    // Add a task for each selected file
    for (const file of videoFiles) {
      const videoTitle = videoFiles.length === 1 ? title.trim() : `${title.trim()} — ${file.name}`;
      const taskId = addTask({
        id: '', // will be assigned by addTask
        subjectId,
        file,
        title: videoTitle,
        description: description.trim(),
        thumbnailFile: thumbnailFile || undefined,
      });

      // Optimistically add video to list
      const optimisticVideo = {
        id: `optimistic-${taskId}`,
        subject_id: subjectId,
        uploaded_by: profile.id,
        title: videoTitle,
        description: description.trim() || null,
        video_url: '',
        video_type: file.type || 'video/mp4',
        video_size: file.size,
        thumbnail_url: thumbnailFile ? URL.createObjectURL(thumbnailFile) : null,
        duration: null,
        view_count: 0,
        comments_enabled: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        uploader_name: formatNameWithTitle(profile.name, profile.role, profile.title_id, profile.gender, t),
        comment_count: 0,
      } as unknown as SubjectVideoWithUploader;
      optimisticVideos.push(optimisticVideo);

      // Start the actual upload (non-blocking)
      startUpload(taskId);
    }

    // Add optimistic videos to the beginning of the list
    setVideos((prev) => [...optimisticVideos, ...prev]);

    // Close modal immediately — uploads continue in background
    setUploadModalOpen(false);
    resetUploadForm();
  };

  // -------------------------------------------------------
  // Reset upload form
  // -------------------------------------------------------
  const resetUploadForm = () => {
    setVideoFiles([]);
    setTitle('');
    setDescription('');
    setThumbnailFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (thumbInputRef.current) {
      thumbInputRef.current.value = '';
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
        toast.error(t('course.toastVideoUpdateFailed'));
      } else {
        toast.success(t('course.toastVideoUpdated'));
        setEditModalOpen(false);
        fetchVideos();
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------
  // Delete video (teacher only)
  // -------------------------------------------------------
  const handleDeleteVideo = async (videoId: string) => {
    // Optimistically remove from local state
    const videoToRemove = videos.find((v) => v.id === videoId);
    setVideos((prev) => prev.filter((v) => v.id !== videoId));
    if (selectedVideo?.id === videoId) {
      setSelectedVideo(null);
      setSelectedVideoId(null);
      setComments([]);
    }
    setConfirmDeleteId(null);

    setDeletingId(videoId);
    try {
      const video = videoToRemove;
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
        toast.error(t('course.toastVideoDeleteFailed'));
        // Rollback optimistic delete
        if (videoToRemove) {
          setVideos((prev) => [videoToRemove, ...prev]);
        }
      } else {
        toast.success(t('course.toastVideoDeleted'));
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
      // Rollback optimistic delete
      if (videoToRemove) {
        setVideos((prev) => [videoToRemove, ...prev]);
      }
    } finally {
      setDeletingId(null);
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
        toast.error(t('course.toastCommentsToggleFailed'));
      } else {
        toast.success(newValue ? t('course.toastCommentsEnabled') : t('course.toastCommentsDisabled'));
        fetchVideos();
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
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
        toast.error(t('course.toastCommentSendFailed'));
      } else {
        setNewComment('');
        fetchComments(selectedVideo.id);
      }
    } catch {
      toast.error(t('course.toastCommentSendError'));
    } finally {
      setSubmittingComment(false);
    }
  };

  // -------------------------------------------------------
  // Edit a comment
  // -------------------------------------------------------
  const handleEditComment = (comment: VideoComment) => {
    setEditingCommentId(comment.id);
    setEditingCommentContent(comment.content);
  };

  const handleSaveEditComment = async () => {
    if (!editingCommentId || !editingCommentContent.trim() || !selectedVideo) return;
    setSavingComment(true);
    try {
      const { error } = await supabase
        .from('video_comments')
        .update({ content: editingCommentContent.trim(), updated_at: new Date().toISOString() })
        .eq('id', editingCommentId);

      if (error) {
        toast.error(t('course.toastCommentEditFailed'));
      } else {
        toast.success(t('course.toastCommentEdited'));
        setEditingCommentId(null);
        setEditingCommentContent('');
        fetchComments(selectedVideo.id);
      }
    } catch {
      toast.error(t('course.toastCommentEditError'));
    } finally {
      setSavingComment(false);
    }
  };

  const handleCancelEditComment = () => {
    setEditingCommentId(null);
    setEditingCommentContent('');
  };

  // -------------------------------------------------------
  // Delete a comment
  // -------------------------------------------------------
  const handleDeleteComment = async (commentId: string) => {
    setDeletingCommentId(commentId);
    try {
      const { error } = await supabase.from('video_comments').delete().eq('id', commentId);

      if (error) {
        toast.error(t('course.toastCommentDeleteFailed'));
      } else {
        toast.success(t('course.toastCommentDeleted'));
        if (selectedVideo) {
          fetchComments(selectedVideo.id);
        }
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
    } finally {
      setDeletingCommentId(null);
      setConfirmDeleteCommentId(null);
    }
  };

  // -------------------------------------------------------
  // Flag (report) a comment
  // -------------------------------------------------------
  const handleFlagComment = async (commentId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      const { error } = await supabase
        .from('video_comments')
        .update({ is_flagged: true, flagged_at: new Date().toISOString(), flagged_by: userId })
        .eq('id', commentId);

      if (error) {
        toast.error(t('course.toastCommentReportFailed'));
      } else {
        toast.success(t('course.toastCommentReported'));
        // Update local state to reflect flag
        setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, is_flagged: true } : c));
      }
    } catch {
      toast.error(t('common.errorUnexpected'));
    }
  };

  // -------------------------------------------------------
  // Record unique view count (first view per user only)
  // -------------------------------------------------------
  const handleVideoPlay = async (videoId: string) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      const { data: isFirstView } = await supabase.rpc('record_video_view', {
        p_video_id: videoId,
        p_user_id: userId,
      });

      // Optimistically update local state only if this was a first view
      if (isFirstView) {
        setVideos((prev) =>
          prev.map((v) => v.id === videoId ? { ...v, view_count: v.view_count + 1 } : v)
        );
        if (selectedVideo?.id === videoId) {
          setSelectedVideo((prev) => prev ? { ...prev, view_count: prev.view_count + 1 } : prev);
        }
      }
    } catch {
      // Silently fail — view count is non-critical
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
          <h3 className="text-xl font-bold text-foreground">{t('course.videos')}</h3>
          <p className="text-muted-foreground text-sm mt-1">{t('course.videoCount', { count: videos.length })}</p>
        </div>
        {role === 'teacher' && (
          <Button
            onClick={() => setUploadModalOpen(true)}
            className="flex items-center gap-2 bg-sky-700 hover:bg-sky-800 text-white"
          >
            <Upload className="h-4 w-4" />
            {t('course.uploadVideo')}
          </Button>
        )}
      </motion.div>

      {/* Video cards */}
      {loading ? (
        <div className="flex items-center justify-center py-16 mt-6">
          <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-400" />
        </div>
      ) : videos.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sky-300 dark:border-sky-900/60 bg-sky-50/30 dark:bg-sky-900/15 py-16 mt-6"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-800/40 mb-4">
            <FileVideo className="h-8 w-8 text-sky-700 dark:text-sky-400" />
          </div>
          <p className="text-lg font-semibold text-foreground mb-1">{t('course.noVideos')}</p>
          <p className="text-sm text-muted-foreground">{t('course.noVideosUploaded')}</p>
        </motion.div>
      ) : (
        <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-6">
          {videos.map((video) => (
            <motion.div key={video.id} variants={itemVariants}>
              <Card
                className={`group overflow-hidden transition-all border-border/60 ${video.id.startsWith('optimistic-') ? 'opacity-70 cursor-wait' : 'cursor-pointer hover:shadow-lg'}`}
                onClick={() => { if (!video.id.startsWith('optimistic-')) handleSelectVideo(video); }}
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
                    {/* Processing overlay for optimistic videos */}
                    {video.id.startsWith('optimistic-') && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                        <div className="flex items-center gap-2 rounded-lg bg-black/60 px-3 py-1.5">
                          <Loader2 className="h-4 w-4 animate-spin text-white" />
                          <span className="text-xs font-medium text-white">{t('course.uploading')}</span>
                        </div>
                      </div>
                    )}
                    {/* Play overlay */}
                    {!video.id.startsWith('optimistic-') && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play className="h-6 w-6 text-white fill-white" />
                        </div>
                      </div>
                    )}
                    {/* Duration badge */}
                    {video.duration && (
                      <div className="absolute bottom-2 start-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
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
                        {formatDate(video.created_at, locale)}
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
          {t('common.goBack')}
        </button>

        {/* Video player */}
        <div className="overflow-hidden rounded-xl border bg-black">
          <video
            ref={videoRef}
            key={selectedVideo.video_url}
            controls
            preload="metadata"
            playsInline
            className="w-full max-h-[70vh] aspect-video"
            poster={selectedVideo.thumbnail_url || undefined}
            onPlay={() => handleVideoPlay(selectedVideo.id)}
          >
            <source src={selectedVideo.video_url} type={selectedVideo.video_type} />
            {t('course.videoNotSupported')}
          </video>
        </div>

        {/* Playback speed selector */}
        <div className="flex items-center gap-1.5 justify-center">
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
            <button
              key={speed}
              onClick={() => {
                setPlaybackSpeed(speed);
                if (videoRef.current) {
                  videoRef.current.playbackRate = speed;
                }
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                playbackSpeed === speed
                  ? 'bg-sky-700 text-white dark:bg-sky-600'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              }`}
            >
              {speed}x
            </button>
          ))}
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
              {formatDate(selectedVideo.created_at, locale)}
            </span>
            <span className="flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5" />
              {formatFileSize(selectedVideo.video_size)}
            </span>
            <span className="flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" />
              {t('course.viewsCount', { count: selectedVideo.view_count })}
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
              {t('common.edit')}
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
                  {t('course.disableComments')}
                </>
              ) : (
                <>
                  <MessageSquare className="h-3.5 w-3.5" />
                  {t('course.enableComments')}
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDeleteId(selectedVideo.id)}
              className="flex items-center gap-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-500 dark:hover:bg-rose-900/20 border-rose-200 dark:border-rose-900/60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('common.delete')}
            </Button>
          </div>
        )}

        {/* Comments section */}
        {selectedVideo.comments_enabled && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-sky-700 dark:text-sky-400" />
              <h3 className="text-base font-bold text-foreground">{t('course.commentsTitle')}</h3>
              {comments.length > 0 && (
                <span className="rounded-full bg-sky-100 dark:bg-sky-800/40 text-sky-800 dark:text-sky-400 px-2 py-0.5 text-[11px] font-medium">
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
                  placeholder={t('course.commentPlaceholder')}
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
                <Loader2 className="h-6 w-6 animate-spin text-sky-700 dark:text-sky-400" />
              </div>
            ) : comments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">{t('course.noCommentsYet')}</p>
                <p className="text-xs text-muted-foreground/70">{t('course.beFirstToComment')}</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
                <AnimatePresence>
                  {comments.map((comment) => {
                    const canDelete =
                      isTeacher || comment.user_id === profile.id;
                    const canEdit = comment.user_id === profile.id;
                    const isEditing = editingCommentId === comment.id;

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
                                {comment.user_name || t('common.user')}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {formatTimeAgo(comment.created_at, t, locale)}
                              </span>
                              {comment.updated_at !== comment.created_at && (
                                <span className="text-[10px] text-muted-foreground/60">
                                  {t('course.edited')}
                                </span>
                              )}
                            </div>
                            {isEditing ? (
                              <div className="flex items-center gap-2 mt-1">
                                <input
                                  type="text"
                                  value={editingCommentContent}
                                  onChange={(e) => setEditingCommentContent(e.target.value)}
                                  className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) handleSaveEditComment();
                                    if (e.key === 'Escape') handleCancelEditComment();
                                  }}
                                />
                                <button
                                  onClick={handleSaveEditComment}
                                  disabled={savingComment || !editingCommentContent.trim()}
                                  className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-60 transition-colors"
                                  title={t('common.save')}
                                >
                                  {savingComment ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                </button>
                                <button
                                  onClick={handleCancelEditComment}
                                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted transition-colors"
                                  title={t('common.cancel')}
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
                                {comment.content}
                              </p>
                            )}
                          </div>
                          {!isEditing && (
                            <div className="flex items-center gap-0.5 shrink-0">
                              {canEdit && (
                                <button
                                  onClick={() => handleEditComment(comment)}
                                  className="flex items-center justify-center rounded-md text-muted-foreground hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors p-1"
                                  title={t('course.editComment')}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  onClick={() => setConfirmDeleteCommentId(comment.id)}
                                  disabled={deletingCommentId === comment.id}
                                  className="flex items-center justify-center rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors p-1 disabled:opacity-60"
                                  title="{t('course.deleteCommentTitle')}"
                                >
                                  {deletingCommentId === comment.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              )}
                              {/* Report button — only for comments that aren't yours */}
                              {!canDelete && (
                                <ReportButton
                                  targetType="comment"
                                  targetId={comment.id}
                                  compact
                                />
                              )}
                              {/* Flagged indicator */}
                              {comment.is_flagged && (
                                <span className="flex items-center gap-1 text-amber-500 text-[10px] font-medium">
                                  <Flag className="h-3 w-3" />
                                  {t('course.flagged')}
                                </span>
                              )}
                            </div>
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
            <p className="text-sm text-muted-foreground">{t('course.commentsDisabledOnVideo')}</p>
            {isTeacher && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleToggleComments(selectedVideo)}
                className="mt-3 flex items-center gap-1.5"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {t('course.enableComments')}
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
      className="space-y-6 mt-6"
      dir={direction}
    >
      {selectedVideo ? (
        <div key="player">
          {renderVideoPlayer()}
        </div>
      ) : (
        <div key="list">
          {renderVideoGrid()}
        </div>
      )}

      {/* ─── Upload Modal ─── */}
      <AnimatePresence>
        {uploadModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto"
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
              className="w-full max-w-md max-h-[90vh] rounded-2xl border bg-background shadow-xl my-4 sm:my-0 flex flex-col"
              dir={direction}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b p-5 shrink-0">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Upload className="h-5 w-5 text-sky-700 dark:text-sky-400" />
                  {t('course.uploadVideo')}
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

              {/* Body — scrollable */}
              <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1 min-h-0">
                {/* Title */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    {t('course.videoTitle')} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('course.videoTitlePlaceholder')}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">{t('course.description')}</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('course.videoDescPlaceholder')}
                    rows={2}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40 resize-none"
                  />
                </div>

                {/* File picker */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    {t('course.videoFile')} <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*"
                      multiple
                      onChange={(e) => {
                        const files = e.target.files;
                        if (files) setVideoFiles(Array.from(files));
                      }}
                      className="w-full rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-3 text-sm text-foreground file:me-3 file:rounded-md file:border-0 file:bg-sky-700 file:text-white file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-sky-800 file:cursor-pointer file:transition-colors"
                    />
                  </div>
                  {videoFiles.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {videoFiles.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2.5">
                          <FileVideo className="h-4 w-4 text-sky-700 dark:text-sky-400 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground truncate">{f.name}</p>
                            <p className="text-[11px] text-muted-foreground">{formatFileSize(f.size)}</p>
                          </div>
                          <button
                            onClick={() => setVideoFiles((prev) => prev.filter((_, idx) => idx !== i))}
                            className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                            title={t('common.remove')}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      {videoFiles.length > 1 && (
                        <p className="text-[11px] text-muted-foreground">{t('course.filesToUpload', { count: videoFiles.length })}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Thumbnail picker */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    {t('course.thumbnail')}
                  </label>
                  <div className="relative">
                    <input
                      ref={thumbInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        setThumbnailFile(file || null);
                      }}
                      className="w-full rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-3 text-sm text-foreground file:me-3 file:rounded-md file:border-0 file:bg-sky-700 file:text-white file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-sky-800 file:cursor-pointer file:transition-colors"
                    />
                  </div>
                  {thumbnailFile && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg border bg-muted/30 p-2.5">
                      <ImageIcon className="h-4 w-4 text-sky-700 dark:text-sky-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">{thumbnailFile.name}</p>
                        <p className="text-[11px] text-muted-foreground">{formatFileSize(thumbnailFile.size)}</p>
                      </div>
                      <button
                        onClick={() => { setThumbnailFile(null); if (thumbInputRef.current) thumbInputRef.current.value = ''; }}
                        className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                        title={t('common.remove')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Info note about background upload */}
                {videoFiles.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-sky-200 dark:border-sky-900/60 bg-sky-50/50 dark:bg-sky-900/15 p-2.5">
                    <Upload className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-sky-700 dark:text-sky-400">{t('course.uploadInBackground')}</p>
                  </div>
                )}
              </div>

              {/* Submit — sticky footer */}
              <div className="border-t p-5 pt-4 shrink-0">
                <Button
                  onClick={handleUpload}
                  disabled={!videoFiles.length || !title.trim()}
                  className="flex items-center justify-center gap-2 w-full bg-sky-700 hover:bg-sky-800 text-white"
                >
                  <Upload className="h-4 w-4" />
                  {t('course.uploadCount', { count: videoFiles.length })}
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
              dir={direction}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b p-5">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Pencil className="h-5 w-5 text-sky-700 dark:text-sky-400" />
                  {t('course.editVideo')}
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
                    {t('course.videoTitle')} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder={t('course.videoTitlePlaceholder')}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    disabled={saving}
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">{t('course.description')}</label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder={t('course.videoDescPlaceholder')}
                    rows={3}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40 resize-none"
                    disabled={saving}
                  />
                </div>

                {/* Toggle comments */}
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    {editCommentsEnabled ? (
                      <MessageSquare className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                    ) : (
                      <MessageSquareOff className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-foreground">{t('course.commentsTitle')}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {editCommentsEnabled ? t('course.commentsEnabled') : t('course.commentsDisabled')}
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
                      {t('common.saving')}
                    </>
                  ) : (
                    <>
                      <Pencil className="h-4 w-4" />
                      {t('course.saveChanges')}
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
        <AlertDialogContent dir={direction}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('course.deleteVideo')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('course.deleteVideoConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 justify-end">
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmDeleteId) handleDeleteVideo(confirmDeleteId);
              }}
              disabled={!!deletingId}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {deletingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t('common.delete')}
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
        <AlertDialogContent dir={direction}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('course.deleteCommentTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('course.deleteCommentConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 justify-end">
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmDeleteCommentId) handleDeleteComment(confirmDeleteCommentId);
              }}
              disabled={!!deletingCommentId}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {deletingCommentId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </motion.div>
  );
}
