-- BloodLink update, 16 Nov 2026
-- The server also runs this automatically on start-up; run it by hand in phpMyAdmin only if you prefer.

-- 1. Each blood bank can set its own minimum per blood group.
--    NULL means "use the default based on how common the blood type is".
ALTER TABLE `bloodbankinventory`
  ADD COLUMN IF NOT EXISTS `min_units` decimal(6,1) DEFAULT NULL COMMENT 'NULL = rarity-based default';

-- 2. (Optional clean-up) Requests that already have enough accepted donors
--    should not keep other donors waiting. Releases those leftover invitations.
UPDATE `matches` m
JOIN `bloodrequests` r ON r.request_id = m.request_id
SET m.match_status = 'expired', m.responded_at = NOW()
WHERE m.match_status = 'proposed'
  AND (SELECT COUNT(*) FROM (SELECT * FROM `matches`) x
       WHERE x.request_id = m.request_id AND x.match_status IN ('accepted','confirmed'))
      >= CEIL(r.quantity_needed);
