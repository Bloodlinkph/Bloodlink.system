-- BloodLink: run this ONCE on the ONLINE database, right after importing
-- your phpMyAdmin export (bloodlink_db.sql).
--
-- Why: XAMPP on Windows ignores upper/lower case in table names, but the
-- online (Linux) database does not. The Python code uses names like
-- `Users` and `BloodRequests`, while the export has `users`, `bloodrequests`.
-- This renames each table to the spelling the code uses.
-- (Not needed on your own computer: XAMPP works with either spelling.)
-- "IF EXISTS" skips tables your export does not have; the server creates those itself.

RENAME TABLE IF EXISTS `admins` TO `Admins`;
RENAME TABLE IF EXISTS `appointments` TO `Appointments`;
RENAME TABLE IF EXISTS `auditlogs` TO `AuditLogs`;
RENAME TABLE IF EXISTS `bloodbankinventory` TO `BloodBankInventory`;
RENAME TABLE IF EXISTS `bloodbanks` TO `BloodBanks`;
RENAME TABLE IF EXISTS `bloodrequests` TO `BloodRequests`;
RENAME TABLE IF EXISTS `bloodtypes` TO `BloodTypes`;
RENAME TABLE IF EXISTS `donations` TO `Donations`;
RENAME TABLE IF EXISTS `donorposts` TO `DonorPosts`;
RENAME TABLE IF EXISTS `donors` TO `Donors`;
RENAME TABLE IF EXISTS `inventoryauditlog` TO `InventoryAuditLog`;
RENAME TABLE IF EXISTS `loginhistory` TO `LoginHistory`;
RENAME TABLE IF EXISTS `matches` TO `Matches`;
RENAME TABLE IF EXISTS `notifications` TO `Notifications`;
RENAME TABLE IF EXISTS `requesters` TO `Requesters`;
RENAME TABLE IF EXISTS `users` TO `Users`;
-- `donor_assessments` stays as it is: the code already spells it in lower case.
