-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Nov 04, 2026 at 04:16 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `bloodlink_db`
--

-- --------------------------------------------------------

--
-- Table structure for table `admins`
--

CREATE TABLE `admins` (
  `admin_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `permission_level` enum('super_admin','staff') NOT NULL DEFAULT 'staff'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `admins`
--

INSERT INTO `admins` (`admin_id`, `user_id`, `permission_level`) VALUES
(1, 2, 'staff'),
(2, 6, 'staff');

-- --------------------------------------------------------

--
-- Table structure for table `appointments`
--

CREATE TABLE `appointments` (
  `appointment_id` int(11) NOT NULL,
  `donor_id` int(11) NOT NULL,
  `blood_bank_id` int(11) NOT NULL,
  `scheduled_at` datetime NOT NULL,
  `status` enum('scheduled','completed','cancelled','no_show') NOT NULL DEFAULT 'scheduled',
  `notes` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `auditlogs`
--

CREATE TABLE `auditlogs` (
  `log_id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `action_performed` varchar(255) NOT NULL,
  `details` varchar(500) DEFAULT NULL,
  `timestamp` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `auditlogs`
--

INSERT INTO `auditlogs` (`log_id`, `user_id`, `action_performed`, `details`, `timestamp`) VALUES
(1, 1, 'account_status_update', 'Status changed to active', '2026-09-05 23:29:19'),
(2, 4, 'account_status_update', 'Status changed to active', '2026-09-06 00:07:37'),
(3, 5, 'account_status_update', 'Status changed to active', '2026-09-06 23:20:29'),
(4, NULL, 'bloodbank_verification_update', 'Blood bank 1 set to verified', '2026-09-06 23:29:52'),
(5, 6, 'account_status_update', 'Status changed to active', '2026-09-24 10:23:04'),
(6, 7, 'account_status_update', 'Status changed to active', '2026-10-27 12:07:13'),
(7, NULL, 'bloodbank_verification_update', 'Blood bank 2 (bloody test) set to verified', '2026-10-27 14:28:41'),
(8, NULL, 'bloodbank_verification_update', 'Blood bank 2 (bloody test) set to rejected', '2026-10-27 14:29:29'),
(9, NULL, 'bloodbank_verification_update', 'Blood bank 2 (bloody test) set to verified', '2026-10-27 16:20:05'),
(10, 9, 'account_status_update', 'Status changed to active', '2026-10-28 14:56:24');

-- --------------------------------------------------------

--
-- Table structure for table `bloodbankinventory`
--

CREATE TABLE `bloodbankinventory` (
  `inventory_id` int(11) NOT NULL,
  `blood_bank_id` int(11) NOT NULL,
  `blood_type_id` int(11) NOT NULL,
  `units_available` decimal(6,1) NOT NULL DEFAULT 0.0,
  `last_updated` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `bloodbankinventory`
--

INSERT INTO `bloodbankinventory` (`inventory_id`, `blood_bank_id`, `blood_type_id`, `units_available`, `last_updated`) VALUES
(1, 1, 8, 0.0, '2026-09-06 23:22:12'),
(2, 1, 7, 1.0, '2026-09-24 23:35:50'),
(3, 1, 1, 6.0, '2026-10-04 21:40:41'),
(8, 1, 2, 3.0, '2026-09-25 08:04:12');

-- --------------------------------------------------------

--
-- Table structure for table `bloodbanks`
--

CREATE TABLE `bloodbanks` (
  `blood_bank_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `bank_name` varchar(150) NOT NULL,
  `license_number` varchar(100) DEFAULT NULL,
  `operating_hours` varchar(150) DEFAULT NULL,
  `verified_status` enum('pending','verified','rejected') NOT NULL DEFAULT 'pending'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `bloodbanks`
--

INSERT INTO `bloodbanks` (`blood_bank_id`, `user_id`, `bank_name`, `license_number`, `operating_hours`, `verified_status`) VALUES
(1, 5, 'Bloodbank test', '', '', 'verified'),
(2, 8, 'bloody test', '', '', 'verified');

-- --------------------------------------------------------

--
-- Table structure for table `bloodrequests`
--

CREATE TABLE `bloodrequests` (
  `request_id` int(11) NOT NULL,
  `requester_id` int(11) NOT NULL,
  `blood_type_id` int(11) NOT NULL,
  `quantity_needed` decimal(6,1) NOT NULL,
  `urgency_level` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `status` enum('pending','matched','fulfilled','cancelled') NOT NULL DEFAULT 'pending',
  `location_needed` varchar(255) DEFAULT NULL,
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `date_requested` datetime NOT NULL DEFAULT current_timestamp(),
  `date_needed_by` datetime DEFAULT NULL,
  `patient_name` varchar(100) DEFAULT NULL,
  `patient_relationship` varchar(30) DEFAULT NULL,
  `hospital_name` varchar(150) DEFAULT NULL,
  `critical_status` enum('none','pending','confirmed','rejected') NOT NULL DEFAULT 'none',
  `critical_reason` varchar(255) DEFAULT NULL,
  `critical_reviewed_by` int(11) DEFAULT NULL,
  `critical_reviewed_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `bloodrequests`
--

INSERT INTO `bloodrequests` (`request_id`, `requester_id`, `blood_type_id`, `quantity_needed`, `urgency_level`, `status`, `location_needed`, `latitude`, `longitude`, `date_requested`, `date_needed_by`, `patient_name`, `patient_relationship`, `hospital_name`, `critical_status`, `critical_reason`, `critical_reviewed_by`, `critical_reviewed_at`) VALUES
(1, 1, 7, 2.0, 'medium', 'pending', 'SIMC', 16.6617990, 121.4730340, '2026-09-06 00:09:18', NULL, NULL, NULL, NULL, 'none', NULL, NULL, NULL),
(2, 1, 8, 2.0, 'high', 'pending', 'bahay', 16.7190000, 121.6890000, '2026-09-25 07:58:00', NULL, NULL, NULL, NULL, 'pending', 'Marked critical before review was required', NULL, NULL),
(3, 3, 5, 1.0, 'medium', 'pending', 'Isabela South Specialist Inc., Maharlika Highway, Echague, Isabela', 16.6960622, 121.6423881, '2026-10-27 15:23:45', NULL, NULL, NULL, 'ISSHI', 'none', NULL, NULL, NULL),
(4, 1, 5, 1.0, 'medium', 'pending', 'Isabela South Specialist Inc., Maharlika Highway, Echague, Isabela', 16.6960622, 121.6423881, '2026-10-27 15:25:37', NULL, NULL, NULL, 'ISSHI', 'none', NULL, NULL, NULL),
(5, 3, 7, 1.5, 'high', 'matched', 'Isabela South Specialist Inc., Maharlika Highway, Echague, Isabela', 16.6960622, 121.6423881, '2026-10-28 15:15:39', NULL, NULL, NULL, NULL, 'none', NULL, NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `bloodtypes`
--

CREATE TABLE `bloodtypes` (
  `blood_type_id` int(11) NOT NULL,
  `blood_type` varchar(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `bloodtypes`
--

INSERT INTO `bloodtypes` (`blood_type_id`, `blood_type`) VALUES
(1, 'A+'),
(2, 'A-'),
(7, 'AB+'),
(8, 'AB-'),
(3, 'B+'),
(4, 'B-'),
(5, 'O+'),
(6, 'O-');

-- --------------------------------------------------------

--
-- Table structure for table `donations`
--

CREATE TABLE `donations` (
  `donation_id` int(11) NOT NULL,
  `donor_id` int(11) NOT NULL,
  `blood_bank_id` int(11) NOT NULL,
  `request_id` int(11) DEFAULT NULL,
  `volume_ml` int(11) NOT NULL DEFAULT 450,
  `donation_date` datetime NOT NULL DEFAULT current_timestamp(),
  `status` enum('completed','deferred','cancelled') NOT NULL DEFAULT 'completed',
  `remarks` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `donations`
--

INSERT INTO `donations` (`donation_id`, `donor_id`, `blood_bank_id`, `request_id`, `volume_ml`, `donation_date`, `status`, `remarks`) VALUES
(1, 1, 1, NULL, 450, '2026-09-06 23:23:21', 'completed', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `donorposts`
--

CREATE TABLE `donorposts` (
  `post_id` int(11) NOT NULL,
  `donor_id` int(11) NOT NULL,
  `note` varchar(255) DEFAULT NULL,
  `available_until` date NOT NULL,
  `status` enum('open','closed') NOT NULL DEFAULT 'open',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `approval_status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `reviewed_by` int(11) DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `rejection_reason` varchar(500) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `donorposts`
--

INSERT INTO `donorposts` (`post_id`, `donor_id`, `note`, `available_until`, `status`, `created_at`, `approval_status`, `reviewed_by`, `reviewed_at`, `rejection_reason`, `updated_at`) VALUES
(1, 2, 'Free on weekends', '2026-11-03', 'open', '2026-10-27 07:16:40', 'pending', NULL, NULL, NULL, '2026-10-28 17:02:18'),
(2, 3, 'will be travelling to London on Nov. 5- 10, 2026', '2026-11-12', 'open', '2026-10-27 07:21:26', 'pending', NULL, NULL, NULL, '2026-10-28 17:02:18'),
(3, 4, NULL, '2026-11-12', 'open', '2026-10-28 07:14:15', 'pending', NULL, NULL, NULL, '2026-10-28 17:02:18');

-- --------------------------------------------------------

--
-- Table structure for table `donors`
--

CREATE TABLE `donors` (
  `donor_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `blood_type_id` int(11) NOT NULL,
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `availability_status` enum('available','unavailable') NOT NULL DEFAULT 'available',
  `eligibility_status` enum('eligible','temporarily_deferred','ineligible') NOT NULL DEFAULT 'eligible',
  `last_donation_date` date DEFAULT NULL,
  `date_registered` datetime NOT NULL DEFAULT current_timestamp(),
  `weight_kg` decimal(5,1) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `donors`
--

INSERT INTO `donors` (`donor_id`, `user_id`, `blood_type_id`, `latitude`, `longitude`, `availability_status`, `eligibility_status`, `last_donation_date`, `date_registered`, `weight_kg`) VALUES
(1, 1, 7, 16.6618190, 121.4730312, 'available', 'eligible', '2026-09-06', '2026-09-05 23:05:58', NULL),
(2, 4, 1, 16.7190850, 121.6781329, 'available', 'eligible', NULL, '2026-10-12 09:26:57', NULL),
(3, 7, 5, 16.7163532, 121.6843284, 'available', 'eligible', NULL, '2026-10-27 12:06:37', NULL),
(4, 9, 7, 16.7359000, 121.6484892, 'available', 'eligible', NULL, '2026-10-28 14:54:33', 45.0),
(5, 10, 5, NULL, NULL, 'available', 'eligible', NULL, '2026-10-29 00:05:24', NULL),
(6, 11, 7, NULL, NULL, 'available', 'eligible', NULL, '2026-10-29 00:08:41', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `donor_assessments`
--

CREATE TABLE `donor_assessments` (
  `assessment_id` int(11) NOT NULL,
  `donor_id` int(11) NOT NULL,
  `age_at_assessment` int(11) NOT NULL,
  `weight_kg` decimal(5,1) NOT NULL,
  `has_fever_or_infection` tinyint(1) NOT NULL,
  `medical_history_disclosed` tinyint(1) NOT NULL,
  `blood_pressure_review_acknowledged` tinyint(1) NOT NULL,
  `parental_consent` tinyint(1) NOT NULL DEFAULT 0,
  `assessment_result` enum('eligible_to_proceed','requires_review','not_eligible') NOT NULL DEFAULT 'requires_review',
  `assessment_note` varchar(500) DEFAULT NULL,
  `assessed_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `inventoryauditlog`
--

CREATE TABLE `inventoryauditlog` (
  `audit_id` int(11) NOT NULL,
  `blood_bank_id` int(11) NOT NULL,
  `blood_type_id` int(11) NOT NULL,
  `changed_by` int(11) DEFAULT NULL,
  `old_units` decimal(6,1) NOT NULL,
  `new_units` decimal(6,1) NOT NULL,
  `change_units` decimal(6,1) NOT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `source` varchar(30) NOT NULL DEFAULT 'manual',
  `changed_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `inventoryauditlog`
--

INSERT INTO `inventoryauditlog` (`audit_id`, `blood_bank_id`, `blood_type_id`, `changed_by`, `old_units`, `new_units`, `change_units`, `reason`, `source`, `changed_at`) VALUES
(1, 1, 1, 5, 5.0, 6.0, 1.0, NULL, 'manual', '2026-10-04 13:40:41');

-- --------------------------------------------------------

--
-- Table structure for table `matches`
--

CREATE TABLE `matches` (
  `match_id` int(11) NOT NULL,
  `request_id` int(11) NOT NULL,
  `donor_id` int(11) NOT NULL,
  `distance_km` decimal(8,2) DEFAULT NULL,
  `match_status` enum('proposed','accepted','declined','confirmed','expired') NOT NULL DEFAULT 'proposed',
  `match_date` timestamp NOT NULL DEFAULT current_timestamp(),
  `responded_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `matches`
--

INSERT INTO `matches` (`match_id`, `request_id`, `donor_id`, `distance_km`, `match_status`, `match_date`, `responded_at`) VALUES
(1, 1, 1, 0.00, 'declined', '2026-09-24 23:52:41', '2026-09-25 07:58:43'),
(32, 4, 3, 5.00, 'proposed', '2026-10-27 07:25:57', NULL),
(69, 5, 4, 4.48, 'accepted', '2026-10-28 07:15:49', '2026-10-28 15:16:49');

-- --------------------------------------------------------

--
-- Table structure for table `notifications`
--

CREATE TABLE `notifications` (
  `notification_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `related_request_id` int(11) DEFAULT NULL,
  `message` varchar(500) NOT NULL,
  `type` enum('sms','in_app','email') NOT NULL DEFAULT 'in_app',
  `date_sent` datetime NOT NULL DEFAULT current_timestamp(),
  `read_status` tinyint(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `notifications`
--

INSERT INTO `notifications` (`notification_id`, `user_id`, `related_request_id`, `message`, `type`, `date_sent`, `read_status`) VALUES
(1, 1, 1, 'Grace Eirian needs AB+ blood (medium urgency). Check your dashboard to respond.', 'in_app', '2026-09-25 07:52:41', 1),
(2, 4, 1, 'Zelly Archer declined your blood request.', 'in_app', '2026-09-25 07:58:43', 1),
(3, 6, NULL, 'Admin logged in: Hazel Tabunar (tabunarhazel@gmail.com).', 'in_app', '2026-10-04 21:59:11', 0),
(4, 2, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-04 22:00:49', 1),
(5, 6, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-04 22:00:49', 0),
(6, 2, NULL, 'Member logged in: Zelly Archer (zelly2900@gmail.com).', 'in_app', '2026-10-04 22:02:47', 1),
(7, 6, NULL, 'Member logged in: Zelly Archer (zelly2900@gmail.com).', 'in_app', '2026-10-04 22:02:47', 0),
(8, 2, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-12 09:23:01', 1),
(9, 6, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-12 09:23:01', 0),
(10, 6, NULL, 'Admin logged in: Hazel Tabunar (tabunarhazel@gmail.com).', 'in_app', '2026-10-12 09:24:34', 0),
(11, 2, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-12 09:25:21', 1),
(12, 6, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-12 09:25:21', 0),
(13, 2, NULL, 'Member logged in: Zelly Archer (zelly2900@gmail.com).', 'in_app', '2026-10-12 09:26:06', 1),
(14, 6, NULL, 'Member logged in: Zelly Archer (zelly2900@gmail.com).', 'in_app', '2026-10-12 09:26:06', 0),
(15, 6, NULL, 'Admin logged in: Hazel Tabunar (tabunarhazel@gmail.com).', 'in_app', '2026-10-12 10:10:46', 0),
(16, 2, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-12 10:11:00', 1),
(17, 6, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-12 10:11:00', 0),
(18, 2, NULL, 'Member logged in: Zelly Archer (zelly2900@gmail.com).', 'in_app', '2026-10-12 10:32:57', 1),
(19, 6, NULL, 'Member logged in: Zelly Archer (zelly2900@gmail.com).', 'in_app', '2026-10-12 10:32:57', 0),
(20, 2, NULL, 'Member logged in: Zelly Archer (zelly2900@gmail.com).', 'in_app', '2026-10-12 11:07:11', 1),
(21, 6, NULL, 'Member logged in: Zelly Archer (zelly2900@gmail.com).', 'in_app', '2026-10-12 11:07:11', 0),
(22, 2, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-27 10:13:58', 1),
(23, 6, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-27 10:13:58', 0),
(24, 2, NULL, 'Member logged in: Zelly Archer (zelly2900@gmail.com).', 'in_app', '2026-10-27 10:16:25', 1),
(25, 6, NULL, 'Member logged in: Zelly Archer (zelly2900@gmail.com).', 'in_app', '2026-10-27 10:16:25', 0),
(26, 6, NULL, 'Admin logged in: Hazel Tabunar (tabunarhazel@gmail.com).', 'in_app', '2026-10-27 10:20:03', 0),
(27, 2, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-27 10:36:28', 1),
(28, 6, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-27 10:36:28', 0),
(29, 6, NULL, 'Admin logged in: Hazel Tabunar (tabunarhazel@gmail.com).', 'in_app', '2026-10-27 11:01:19', 0),
(30, 2, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-27 11:01:28', 1),
(31, 6, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-27 11:01:28', 0),
(32, 2, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-27 11:10:51', 1),
(33, 6, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-27 11:10:51', 0),
(34, 6, NULL, 'Admin logged in: Hazel Tabunar (tabunarhazel@gmail.com).', 'in_app', '2026-10-27 11:36:37', 0),
(35, 2, NULL, 'New member account registered: Ellen  Cabalteja (aellnc22@gmail.com). Awaiting approval.', 'in_app', '2026-10-27 12:06:37', 1),
(36, 6, NULL, 'New member account registered: Ellen  Cabalteja (aellnc22@gmail.com). Awaiting approval.', 'in_app', '2026-10-27 12:06:37', 0),
(37, 6, NULL, 'Admin logged in: Hazel Tabunar (tabunarhazel@gmail.com).', 'in_app', '2026-10-27 12:06:56', 0),
(38, 2, NULL, 'Member logged in: Ellen  Cabalteja (aellnc22@gmail.com).', 'in_app', '2026-10-27 12:07:22', 1),
(39, 6, NULL, 'Member logged in: Ellen  Cabalteja (aellnc22@gmail.com).', 'in_app', '2026-10-27 12:07:22', 0),
(40, 2, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-27 12:08:20', 1),
(41, 6, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-27 12:08:20', 0),
(42, 6, NULL, 'Admin logged in: Hazel Tabunar (tabunarhazel@gmail.com).', 'in_app', '2026-10-27 13:05:31', 0),
(43, 2, NULL, 'Member logged in: Zelly Archer (zelly2900@gmail.com).', 'in_app', '2026-10-27 13:05:50', 0),
(44, 6, NULL, 'Member logged in: Zelly Archer (zelly2900@gmail.com).', 'in_app', '2026-10-27 13:05:50', 0),
(45, 2, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-27 13:18:24', 0),
(46, 6, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-27 13:18:24', 0),
(47, 6, NULL, 'Admin logged in: Hazel Tabunar (tabunarhazel@gmail.com).', 'in_app', '2026-10-27 13:41:44', 0),
(48, 6, NULL, 'Admin logged in: Hazel Tabunar (tabunarhazel@gmail.com).', 'in_app', '2026-10-27 14:13:20', 0),
(49, 2, NULL, 'Admin logged in: Angel (angelwasin21@gmail.com).', 'in_app', '2026-10-27 14:17:34', 0),
(50, 2, NULL, 'Member logged in: Ellen  Cabalteja (aellnc22@gmail.com).', 'in_app', '2026-10-27 14:17:48', 0),
(51, 6, NULL, 'Member logged in: Ellen  Cabalteja (aellnc22@gmail.com).', 'in_app', '2026-10-27 14:17:48', 0),
(52, 2, NULL, 'New blood bank registered: bloody test (jaylordgelacio40@gmail.com). Needs verification.', 'in_app', '2026-10-27 14:27:18', 0),
(53, 6, NULL, 'New blood bank registered: bloody test (jaylordgelacio40@gmail.com). Needs verification.', 'in_app', '2026-10-27 14:27:18', 0),
(54, 8, NULL, 'Your blood bank has been verified. You can now manage your inventory.', 'in_app', '2026-10-27 14:28:41', 0),
(55, 8, NULL, 'Your blood bank verification was rejected. Correct your bank name or license number in Edit profile to re-apply, or contact an admin.', 'in_app', '2026-10-27 14:29:29', 0),
(56, 2, NULL, 'Blood bank logged in: Jaylord (jaylordgelacio40@gmail.com).', 'in_app', '2026-10-27 14:29:53', 0),
(57, 6, NULL, 'Blood bank logged in: Jaylord (jaylordgelacio40@gmail.com).', 'in_app', '2026-10-27 14:29:53', 0),
(58, 2, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-27 14:37:26', 0),
(59, 6, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-27 14:37:26', 0),
(60, 2, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-27 15:08:13', 0),
(61, 6, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-27 15:08:13', 0),
(62, 2, NULL, 'Member logged in: Ellen  Cabalteja (aellnc22@gmail.com).', 'in_app', '2026-10-27 15:19:13', 0),
(63, 6, NULL, 'Member logged in: Ellen  Cabalteja (aellnc22@gmail.com).', 'in_app', '2026-10-27 15:19:13', 0),
(64, 7, 4, 'Grace Eirian needs 1 unit of O+ blood (medium urgency). Check your dashboard to respond.', 'in_app', '2026-10-27 15:25:57', 0),
(65, 6, NULL, 'Admin logged in: Hazel Tabunar (tabunarhazel@gmail.com).', 'in_app', '2026-10-27 15:27:25', 0),
(66, 2, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-27 15:42:20', 0),
(67, 6, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-27 15:42:20', 0),
(68, 2, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-27 16:01:26', 0),
(69, 6, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-27 16:01:26', 0),
(70, 6, NULL, 'Admin logged in: Hazel Tabunar (tabunarhazel@gmail.com).', 'in_app', '2026-10-27 16:07:05', 0),
(71, 2, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-27 16:14:22', 0),
(72, 6, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-27 16:14:22', 0),
(73, 8, NULL, 'Your blood bank has been verified. You can now manage your inventory.', 'in_app', '2026-10-27 16:20:05', 0),
(74, 6, NULL, 'Admin logged in: Hazel Tabunar (tabunarhazel@gmail.com).', 'in_app', '2026-10-28 14:48:53', 0),
(75, 2, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-28 14:49:16', 0),
(76, 6, NULL, 'Blood bank logged in: Zelly Tabunar (tabunarhazel05@gmail.com).', 'in_app', '2026-10-28 14:49:16', 0),
(77, 2, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-28 14:49:53', 0),
(78, 6, NULL, 'Member logged in: Grace Eirian (graceeirian@gmail.com).', 'in_app', '2026-10-28 14:49:53', 0),
(79, 2, NULL, 'New member account registered: Divine Grace Espiritu (divine@gmail.com). Awaiting approval.', 'in_app', '2026-10-28 14:54:33', 0),
(80, 6, NULL, 'New member account registered: Divine Grace Espiritu (divine@gmail.com). Awaiting approval.', 'in_app', '2026-10-28 14:54:33', 0),
(81, 2, NULL, 'Member logged in: Divine Grace Espiritu (divine@gmail.com).', 'in_app', '2026-10-28 14:57:44', 0),
(82, 6, NULL, 'Member logged in: Divine Grace Espiritu (divine@gmail.com).', 'in_app', '2026-10-28 14:57:44', 0),
(83, 2, NULL, 'Member logged in: Ellen  Cabalteja (aellnc22@gmail.com).', 'in_app', '2026-10-28 15:14:30', 0),
(84, 6, NULL, 'Member logged in: Ellen  Cabalteja (aellnc22@gmail.com).', 'in_app', '2026-10-28 15:14:30', 0),
(85, 9, 5, 'Ellen  Cabalteja needs 1.5 units of AB+ blood (high urgency). Check your dashboard to respond.', 'in_app', '2026-10-28 15:15:49', 0),
(86, 7, 5, 'Divine Grace Espiritu accepted your blood request.', 'in_app', '2026-10-28 15:16:49', 0),
(87, 6, NULL, 'Admin logged in: Hazel Tabunar (tabunarhazel@gmail.com).', 'in_app', '2026-10-28 15:20:15', 0),
(88, 6, NULL, 'Admin logged in: Hazel Tabunar (tabunarhazel@gmail.com).', 'in_app', '2026-10-28 16:13:29', 0),
(89, 2, NULL, 'Member logged in: Divine Grace Espiritu (divine@gmail.com).', 'in_app', '2026-10-28 19:01:39', 0),
(90, 6, NULL, 'Member logged in: Divine Grace Espiritu (divine@gmail.com).', 'in_app', '2026-10-28 19:01:39', 0),
(91, 2, NULL, 'New member account registered: Joanna Perdido (joanperdido@gmail.com).', 'in_app', '2026-10-29 00:05:24', 0),
(92, 6, NULL, 'New member account registered: Joanna Perdido (joanperdido@gmail.com).', 'in_app', '2026-10-29 00:05:24', 0),
(93, 2, NULL, 'Member logged in: Joanna Perdido (joanperdido@gmail.com).', 'in_app', '2026-10-29 00:05:37', 0),
(94, 6, NULL, 'Member logged in: Joanna Perdido (joanperdido@gmail.com).', 'in_app', '2026-10-29 00:05:37', 0),
(95, 2, NULL, 'New member account registered: Grace Soriano (sorianograce@gmail.com).', 'in_app', '2026-10-29 00:08:41', 0),
(96, 6, NULL, 'New member account registered: Grace Soriano (sorianograce@gmail.com).', 'in_app', '2026-10-29 00:08:41', 0),
(97, 2, NULL, 'Member logged in: Grace Soriano (sorianograce@gmail.com).', 'in_app', '2026-10-29 00:08:48', 0),
(98, 6, NULL, 'Member logged in: Grace Soriano (sorianograce@gmail.com).', 'in_app', '2026-10-29 00:08:48', 0),
(99, 2, NULL, 'Member logged in: Grace Soriano (sorianograce@gmail.com).', 'in_app', '2026-10-29 01:32:45', 0),
(100, 6, NULL, 'Member logged in: Grace Soriano (sorianograce@gmail.com).', 'in_app', '2026-10-29 01:32:45', 0),
(101, 2, NULL, 'Member logged in: Grace Soriano (sorianograce@gmail.com).', 'in_app', '2026-10-29 02:31:14', 0),
(102, 6, NULL, 'Member logged in: Grace Soriano (sorianograce@gmail.com).', 'in_app', '2026-10-29 02:31:14', 0);

-- --------------------------------------------------------

--
-- Table structure for table `requesters`
--

CREATE TABLE `requesters` (
  `requester_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `requester_type` enum('individual','hospital','family_member') NOT NULL DEFAULT 'individual',
  `affiliated_hospital` varchar(150) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `requesters`
--

INSERT INTO `requesters` (`requester_id`, `user_id`, `requester_type`, `affiliated_hospital`) VALUES
(1, 4, 'individual', NULL),
(2, 1, 'individual', NULL),
(3, 7, 'individual', ''),
(4, 9, 'individual', ''),
(5, 10, 'individual', ''),
(6, 11, 'individual', '');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `user_id` int(11) NOT NULL,
  `full_name` varchar(150) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `contact_number` varchar(20) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `barangay` varchar(100) DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `role` enum('donor','requester','member','blood_bank','admin') NOT NULL,
  `account_status` enum('pending','active','disabled') NOT NULL DEFAULT 'pending',
  `date_created` datetime NOT NULL DEFAULT current_timestamp(),
  `last_login` datetime DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `gender` varchar(20) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`user_id`, `full_name`, `email`, `password_hash`, `contact_number`, `address`, `barangay`, `city`, `role`, `account_status`, `date_created`, `last_login`, `date_of_birth`, `gender`, `created_at`) VALUES
(1, 'Zelly Archer', 'zelly2900@gmail.com', 'scrypt:32768:8:1$x9s8kTwsIVSsZfoi$12a0f28f21bc8ade4b7e49e0c6802701d3be4c1810b18f94679939e0ddd2c307969f5b6b3ec3b62171dce98ed5ccd6a1fe3e4b2da43c0d18fc514945190d7246', '09618008411', 'Cordon, Isabela', 'Sagat', 'Cordon', 'member', 'active', '2026-09-05 23:05:58', '2026-10-27 13:10:41', NULL, NULL, '2026-10-27 11:23:56'),
(2, 'Hazel Tabunar', 'tabunarhazel@gmail.com', 'scrypt:32768:8:1$aiRY50whpJ5jeA8A$3a91b07885e03f7d0e1b49d18e5c76da5db22c231f94885fd0fd7c0bc9aa25a999210711b319394a5bb8aaa05db03fd56d7d16ca5544c1f3293d62e88f36d7fb', '09618008411', 'Cordon, Isabela', 'Sagat', 'Cordon', 'admin', 'active', '2026-09-05 23:21:35', '2026-10-28 16:13:29', NULL, NULL, '2026-10-27 11:23:56'),
(4, 'Grace Eirian', 'graceeirian@gmail.com', 'scrypt:32768:8:1$Ww1H2MmGsGcZRo4N$da1fbcd41609b699ff9c84fa08482b8cf86b1926a0d63c5176f0d681cc1147749be0da561f700df9575ceb801aa58e2043ae7d4f21c83fc2c6a094637e167640', '09618008411', 'Echague, Isabela', 'San Fabian', 'Echague', 'member', 'active', '2026-09-06 00:07:21', '2026-10-28 15:12:55', NULL, NULL, '2026-10-27 11:23:56'),
(5, 'Zelly Tabunar', 'tabunarhazel05@gmail.com', 'scrypt:32768:8:1$oREeUuL9BRXuk0OA$03899c1ef5540d7bed456d15a6913fe6eb462bfb9b8c792a0f7ae4946edc382406ac00970696fe6240ce27bc06d000fb2fcaddb9fd32be376c46bed72ba2e1bc', '09618008411', 'Echague, Isabela', 'Echague', 'Isabela', 'blood_bank', 'active', '2026-09-06 23:20:07', '2026-10-28 14:49:16', NULL, NULL, '2026-10-27 11:23:56'),
(6, 'Angel', 'angelwasin21@gmail.com', 'scrypt:32768:8:1$0bjp6KnO9MHiut02$71ec05d73e2df1eb5239f1b5206ee2ad39350e0c2905d6fa39d1aced192e81d43c94e0393661ff21222fd806f1b737326a7ce339f4d3e582c822d3c2183481db', '09669787254', 'Purok 4', 'Gaddanan', 'San Mateo', 'admin', 'active', '2026-09-24 10:22:44', '2026-10-27 14:17:34', NULL, NULL, '2026-10-27 11:23:56'),
(7, 'Ellen  Cabalteja', 'aellnc22@gmail.com', 'scrypt:32768:8:1$Os8wmc0rVpoRsW5f$517c3a1840aeb8f472eefc0ccaace8641ae2c1f1c9fae383a56e0561b6713880af9e7a1405e326ebcd5c31c568bb4c27f721dd54704896f1839dfe824f3d23b9', '09233461985', 'P4, Burgos, Cabarroguis, Quirino', 'Burgos', 'Quirino', 'member', 'active', '2026-10-27 12:06:37', '2026-10-28 15:14:30', NULL, NULL, '2026-10-27 12:06:37'),
(8, 'Jaylord', 'jaylordgelacio40@gmail.com', 'scrypt:32768:8:1$Buu82nvBPZzaTD5W$3295b3970c8b737165e7db3c1e8ff46a49c19c84c1aa725bfc20d3027245d2002901349ddd5ff62124654484b9c17390522912a95e6405bca0a8602ed1759b2a', '09786543216', 'Turod Norte, Cordon, Isabela', 'Turod Norte', 'Cordon', 'blood_bank', 'active', '2026-10-27 14:27:18', '2026-10-27 14:29:53', NULL, NULL, '2026-10-27 14:27:18'),
(9, 'Divine Grace Espiritu', 'divine@gmail.com', 'scrypt:32768:8:1$OtvbA9Fh6Avn2Lnn$89d1c61ae559b50c85e8dab1c19b78dae28c21c29b6284dbfee6366b1695b093e416aadd6bacdf38432233b728f11d19ad6747ac73fc2155620c0c47ac0605dd', '09456543786', 'San Guillermo, Isabela', 'Centro', 'SanGuillermo', 'member', 'active', '2026-10-28 14:54:33', '2026-10-28 19:21:21', '2006-11-01', 'female', '2026-10-28 14:54:33'),
(10, 'Joanna Perdido', 'joanperdido@gmail.com', 'scrypt:32768:8:1$CvRizFSic4d0ZmJu$754ccb375b95a9ef58696d7981e99648e6ab2661ccb1269d6491cfd4286a6e948d9c66e6dca96d7675eef0c862ee119d2858cc50a74464de4bad0e398f978f1e', '09872678301', 'Ramon, Isabela', 'San Antonio', 'Ramon', 'member', 'active', '2026-10-29 00:05:24', '2026-10-29 00:05:37', NULL, NULL, '2026-10-29 00:05:24'),
(11, 'Grace Soriano', 'sorianograce@gmail.com', 'scrypt:32768:8:1$ClxhJN6jLNribRX0$370a3242a4fb779a540cd6d8fc1dcbf02306fc05295b0c6831e2cba8d824aa4166d2e7b95aed1376fb4fbde7e4d60723e5915f0f2503350dc0fab9efb00bd045', '09876546781', 'Ramon, Isabela', 'San Antonio', 'Ramon', 'member', 'active', '2026-10-29 00:08:41', '2026-10-29 02:31:14', NULL, NULL, '2026-10-29 00:08:41');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `admins`
--
ALTER TABLE `admins`
  ADD PRIMARY KEY (`admin_id`),
  ADD UNIQUE KEY `user_id` (`user_id`);

--
-- Indexes for table `appointments`
--
ALTER TABLE `appointments`
  ADD PRIMARY KEY (`appointment_id`),
  ADD KEY `idx_appt_bank_time` (`blood_bank_id`,`scheduled_at`),
  ADD KEY `idx_appt_donor` (`donor_id`);

--
-- Indexes for table `auditlogs`
--
ALTER TABLE `auditlogs`
  ADD PRIMARY KEY (`log_id`),
  ADD KEY `fk_log_user` (`user_id`);

--
-- Indexes for table `bloodbankinventory`
--
ALTER TABLE `bloodbankinventory`
  ADD PRIMARY KEY (`inventory_id`),
  ADD UNIQUE KEY `uq_bank_bloodtype` (`blood_bank_id`,`blood_type_id`),
  ADD KEY `fk_inventory_bloodtype` (`blood_type_id`);

--
-- Indexes for table `bloodbanks`
--
ALTER TABLE `bloodbanks`
  ADD PRIMARY KEY (`blood_bank_id`),
  ADD UNIQUE KEY `user_id` (`user_id`);

--
-- Indexes for table `bloodrequests`
--
ALTER TABLE `bloodrequests`
  ADD PRIMARY KEY (`request_id`),
  ADD KEY `fk_request_requester` (`requester_id`),
  ADD KEY `idx_request_bloodtype` (`blood_type_id`),
  ADD KEY `idx_request_status` (`status`);

--
-- Indexes for table `bloodtypes`
--
ALTER TABLE `bloodtypes`
  ADD PRIMARY KEY (`blood_type_id`),
  ADD UNIQUE KEY `blood_type` (`blood_type`);

--
-- Indexes for table `donations`
--
ALTER TABLE `donations`
  ADD PRIMARY KEY (`donation_id`),
  ADD KEY `fk_donation_donor` (`donor_id`),
  ADD KEY `fk_donation_bank` (`blood_bank_id`),
  ADD KEY `fk_donation_request` (`request_id`);

--
-- Indexes for table `donorposts`
--
ALTER TABLE `donorposts`
  ADD PRIMARY KEY (`post_id`),
  ADD KEY `idx_post_donor` (`donor_id`,`status`),
  ADD KEY `idx_post_open` (`status`,`available_until`),
  ADD KEY `idx_donorposts_approval` (`approval_status`,`created_at`),
  ADD KEY `fk_donorposts_reviewer` (`reviewed_by`);

--
-- Indexes for table `donors`
--
ALTER TABLE `donors`
  ADD PRIMARY KEY (`donor_id`),
  ADD UNIQUE KEY `user_id` (`user_id`),
  ADD UNIQUE KEY `uq_donors_user` (`user_id`),
  ADD KEY `idx_donor_bloodtype` (`blood_type_id`),
  ADD KEY `idx_donor_availability` (`availability_status`),
  ADD KEY `idx_donor_location` (`latitude`,`longitude`);

--
-- Indexes for table `donor_assessments`
--
ALTER TABLE `donor_assessments`
  ADD PRIMARY KEY (`assessment_id`),
  ADD KEY `idx_assessment_donor` (`donor_id`,`assessed_at`);

--
-- Indexes for table `inventoryauditlog`
--
ALTER TABLE `inventoryauditlog`
  ADD PRIMARY KEY (`audit_id`),
  ADD KEY `idx_audit_bank_time` (`blood_bank_id`,`changed_at`),
  ADD KEY `idx_audit_user` (`changed_by`);

--
-- Indexes for table `matches`
--
ALTER TABLE `matches`
  ADD PRIMARY KEY (`match_id`),
  ADD UNIQUE KEY `uq_request_donor` (`request_id`,`donor_id`),
  ADD KEY `donor_id` (`donor_id`);

--
-- Indexes for table `notifications`
--
ALTER TABLE `notifications`
  ADD PRIMARY KEY (`notification_id`),
  ADD KEY `fk_notification_request` (`related_request_id`),
  ADD KEY `idx_notification_user` (`user_id`,`read_status`);

--
-- Indexes for table `requesters`
--
ALTER TABLE `requesters`
  ADD PRIMARY KEY (`requester_id`),
  ADD UNIQUE KEY `user_id` (`user_id`),
  ADD UNIQUE KEY `uq_requesters_user` (`user_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`user_id`),
  ADD UNIQUE KEY `email` (`email`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `admins`
--
ALTER TABLE `admins`
  MODIFY `admin_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `appointments`
--
ALTER TABLE `appointments`
  MODIFY `appointment_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `auditlogs`
--
ALTER TABLE `auditlogs`
  MODIFY `log_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT for table `bloodbankinventory`
--
ALTER TABLE `bloodbankinventory`
  MODIFY `inventory_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- AUTO_INCREMENT for table `bloodbanks`
--
ALTER TABLE `bloodbanks`
  MODIFY `blood_bank_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `bloodrequests`
--
ALTER TABLE `bloodrequests`
  MODIFY `request_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `bloodtypes`
--
ALTER TABLE `bloodtypes`
  MODIFY `blood_type_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- AUTO_INCREMENT for table `donations`
--
ALTER TABLE `donations`
  MODIFY `donation_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `donorposts`
--
ALTER TABLE `donorposts`
  MODIFY `post_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `donors`
--
ALTER TABLE `donors`
  MODIFY `donor_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `donor_assessments`
--
ALTER TABLE `donor_assessments`
  MODIFY `assessment_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `inventoryauditlog`
--
ALTER TABLE `inventoryauditlog`
  MODIFY `audit_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `matches`
--
ALTER TABLE `matches`
  MODIFY `match_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=70;

--
-- AUTO_INCREMENT for table `notifications`
--
ALTER TABLE `notifications`
  MODIFY `notification_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=103;

--
-- AUTO_INCREMENT for table `requesters`
--
ALTER TABLE `requesters`
  MODIFY `requester_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `user_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=12;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `admins`
--
ALTER TABLE `admins`
  ADD CONSTRAINT `fk_admin_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

--
-- Constraints for table `auditlogs`
--
ALTER TABLE `auditlogs`
  ADD CONSTRAINT `fk_log_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `bloodbankinventory`
--
ALTER TABLE `bloodbankinventory`
  ADD CONSTRAINT `fk_inventory_bank` FOREIGN KEY (`blood_bank_id`) REFERENCES `bloodbanks` (`blood_bank_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_inventory_bloodtype` FOREIGN KEY (`blood_type_id`) REFERENCES `bloodtypes` (`blood_type_id`);

--
-- Constraints for table `bloodbanks`
--
ALTER TABLE `bloodbanks`
  ADD CONSTRAINT `fk_bloodbank_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

--
-- Constraints for table `bloodrequests`
--
ALTER TABLE `bloodrequests`
  ADD CONSTRAINT `fk_request_bloodtype` FOREIGN KEY (`blood_type_id`) REFERENCES `bloodtypes` (`blood_type_id`),
  ADD CONSTRAINT `fk_request_requester` FOREIGN KEY (`requester_id`) REFERENCES `requesters` (`requester_id`) ON DELETE CASCADE;

--
-- Constraints for table `donations`
--
ALTER TABLE `donations`
  ADD CONSTRAINT `fk_donation_bank` FOREIGN KEY (`blood_bank_id`) REFERENCES `bloodbanks` (`blood_bank_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_donation_donor` FOREIGN KEY (`donor_id`) REFERENCES `donors` (`donor_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_donation_request` FOREIGN KEY (`request_id`) REFERENCES `bloodrequests` (`request_id`) ON DELETE SET NULL;

--
-- Constraints for table `donorposts`
--
ALTER TABLE `donorposts`
  ADD CONSTRAINT `fk_donorposts_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `donors`
--
ALTER TABLE `donors`
  ADD CONSTRAINT `fk_donor_bloodtype` FOREIGN KEY (`blood_type_id`) REFERENCES `bloodtypes` (`blood_type_id`),
  ADD CONSTRAINT `fk_donor_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

--
-- Constraints for table `donor_assessments`
--
ALTER TABLE `donor_assessments`
  ADD CONSTRAINT `fk_assessment_donor` FOREIGN KEY (`donor_id`) REFERENCES `donors` (`donor_id`) ON DELETE CASCADE;

--
-- Constraints for table `matches`
--
ALTER TABLE `matches`
  ADD CONSTRAINT `matches_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `bloodrequests` (`request_id`),
  ADD CONSTRAINT `matches_ibfk_2` FOREIGN KEY (`donor_id`) REFERENCES `donors` (`donor_id`);

--
-- Constraints for table `notifications`
--
ALTER TABLE `notifications`
  ADD CONSTRAINT `fk_notification_request` FOREIGN KEY (`related_request_id`) REFERENCES `bloodrequests` (`request_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_notification_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

--
-- Constraints for table `requesters`
--
ALTER TABLE `requesters`
  ADD CONSTRAINT `fk_requester_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
