-- =====================================================
-- v36: Notifications REPLICA IDENTITY FULL for Realtime DELETE
-- =====================================================
-- Without REPLICA IDENTITY FULL, the Realtime DELETE event payload
-- only contains the primary key (id), not the other columns needed
-- for the filter (user_id). This means filtered DELETE events
-- never reach the client, causing notifications to "reappear"
 after deletion because the client never receives the DELETE event.

ALTER TABLE public.notifications REPLICA IDENTITY FULL;
