-- Widen the journey event taxonomy beyond navigation/lifecycle/auth/click so
-- session_actions can carry richer UI/behavior events (forms, search, modals,
-- downloads, uploads, purchases, logout) alongside API traffic.

ALTER TABLE session_actions DROP CONSTRAINT IF EXISTS session_actions_kind_check;
ALTER TABLE session_actions ADD CONSTRAINT session_actions_kind_check
  CHECK (kind IN (
    'navigation', 'lifecycle', 'auth', 'click',
    'screen_view', 'form_start', 'form_submit', 'search', 'filter',
    'modal_open', 'modal_close', 'download', 'file_upload',
    'purchase_start', 'purchase_complete', 'logout'
  ));
