CREATE TABLE `activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`activity_date` text NOT NULL,
	`end_date` text,
	`location` text,
	`category_id` integer,
	`excerpt` text,
	`description_md` text,
	`description_html` text,
	`cover_media_id` integer,
	`url` text,
	`is_featured` integer DEFAULT false NOT NULL,
	`is_published` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `activity_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cover_media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activities_slug_uq` ON `activities` (`slug`);--> statement-breakpoint
CREATE INDEX `activities_date_idx` ON `activities` (`activity_date`);--> statement-breakpoint
CREATE INDEX `activities_published_idx` ON `activities` (`is_published`);--> statement-breakpoint
CREATE TABLE `activity_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`color` text DEFAULT '#0ea5a4' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_categories_slug_uq` ON `activity_categories` (`slug`);--> statement-breakpoint
CREATE TABLE `activity_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`activity_id` integer NOT NULL,
	`media_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_images_activity_idx` ON `activity_images` (`activity_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`entity` text,
	`entity_id` text,
	`meta` text,
	`ip_address` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_user_idx` ON `audit_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_logs` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `authors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`full_name` text NOT NULL,
	`last_name` text,
	`first_name` text,
	`normalized` text NOT NULL,
	`is_self` integer DEFAULT false NOT NULL,
	`orcid` text,
	`url` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authors_normalized_uq` ON `authors` (`normalized`);--> statement-breakpoint
CREATE INDEX `authors_self_idx` ON `authors` (`is_self`);--> statement-breakpoint
CREATE TABLE `awards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`issuer` text,
	`year` integer,
	`description` text,
	`url` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `awards_year_idx` ON `awards` (`year`);--> statement-breakpoint
CREATE TABLE `blog_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`color` text DEFAULT '#5b6bf0' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blog_categories_slug_uq` ON `blog_categories` (`slug`);--> statement-breakpoint
CREATE TABLE `blog_post_gallery` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`media_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `blog_posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blog_gallery_post_idx` ON `blog_post_gallery` (`post_id`);--> statement-breakpoint
CREATE TABLE `blog_post_tags` (
	`post_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`post_id`, `tag_id`),
	FOREIGN KEY (`post_id`) REFERENCES `blog_posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `blog_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blog_post_tags_tag_idx` ON `blog_post_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `blog_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text,
	`content_md` text DEFAULT '' NOT NULL,
	`content_html` text DEFAULT '' NOT NULL,
	`toc` text DEFAULT '[]',
	`cover_media_id` integer,
	`category_id` integer,
	`author_id` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`scheduled_for` integer,
	`is_featured` integer DEFAULT false NOT NULL,
	`show_toc` integer DEFAULT true NOT NULL,
	`reading_minutes` integer DEFAULT 1 NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`seo_title` text,
	`seo_description` text,
	`og_media_id` integer,
	`canonical_url` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`cover_media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `blog_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`og_media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blog_posts_slug_uq` ON `blog_posts` (`slug`);--> statement-breakpoint
CREATE INDEX `blog_posts_status_pub_idx` ON `blog_posts` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `blog_posts_category_idx` ON `blog_posts` (`category_id`);--> statement-breakpoint
CREATE INDEX `blog_posts_featured_idx` ON `blog_posts` (`is_featured`);--> statement-breakpoint
CREATE INDEX `blog_posts_scheduled_idx` ON `blog_posts` (`scheduled_for`);--> statement-breakpoint
CREATE TABLE `blog_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blog_tags_slug_uq` ON `blog_tags` (`slug`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`subject` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`country` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE INDEX `contacts_status_idx` ON `contacts` (`status`);--> statement-breakpoint
CREATE INDEX `contacts_created_idx` ON `contacts` (`created_at`);--> statement-breakpoint
CREATE TABLE `education` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`degree` text NOT NULL,
	`field` text,
	`institution` text NOT NULL,
	`department` text,
	`location` text,
	`start_year` integer,
	`end_year` integer,
	`completed_on` text,
	`thesis_title` text,
	`advisor` text,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `education_sort_idx` ON `education` (`sort_order`);--> statement-breakpoint
CREATE TABLE `experiences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text DEFAULT 'academic' NOT NULL,
	`title` text NOT NULL,
	`organization` text NOT NULL,
	`department` text,
	`location` text,
	`start_date` text NOT NULL,
	`end_date` text,
	`is_current` integer DEFAULT false NOT NULL,
	`summary` text,
	`description_md` text,
	`description_html` text,
	`url` text,
	`is_featured` integer DEFAULT false NOT NULL,
	`is_published` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `experiences_type_idx` ON `experiences` (`type`);--> statement-breakpoint
CREATE INDEX `experiences_start_idx` ON `experiences` (`start_date`);--> statement-breakpoint
CREATE TABLE `image_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`media_id` integer,
	`required_width` integer,
	`required_height` integer,
	`aspect_ratio` real,
	`tolerance` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `image_slots_slug_uq` ON `image_slots` (`slug`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`r2_key` text NOT NULL,
	`thumb_key` text,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`alt` text DEFAULT '' NOT NULL,
	`caption` text,
	`folder` text DEFAULT 'uploads' NOT NULL,
	`blurhash` text,
	`uploaded_by` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_r2key_uq` ON `media` (`r2_key`);--> statement-breakpoint
CREATE INDEX `media_folder_idx` ON `media` (`folder`);--> statement-breakpoint
CREATE INDEX `media_created_idx` ON `media` (`created_at`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization` text NOT NULL,
	`role` text,
	`start_year` integer,
	`end_year` integer,
	`url` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memberships_sort_idx` ON `memberships` (`sort_order`);--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`honorific` text,
	`title` text NOT NULL,
	`institution` text,
	`department` text,
	`tagline` text,
	`summary` text,
	`professional_bio_md` text,
	`professional_bio_html` text,
	`academic_bio_md` text,
	`academic_bio_html` text,
	`email` text,
	`phone` text,
	`office` text,
	`address` text,
	`latitude` real,
	`longitude` real,
	`google_maps_url` text,
	`cv_media_id` integer,
	`orcid` text,
	`google_scholar` text,
	`research_gate` text,
	`scopus_id` text,
	`web_of_science` text,
	`github` text,
	`linkedin` text,
	`twitter` text,
	`youtube` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`cv_media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`funder` text,
	`grant_number` text,
	`role` text DEFAULT 'researcher' NOT NULL,
	`team` text,
	`start_date` text,
	`end_date` text,
	`status` text DEFAULT 'completed' NOT NULL,
	`scope` text DEFAULT 'national' NOT NULL,
	`description_md` text,
	`description_html` text,
	`url` text,
	`is_featured` integer DEFAULT false NOT NULL,
	`is_published` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status`);--> statement-breakpoint
CREATE TABLE `publication_authors` (
	`publication_id` integer NOT NULL,
	`author_id` integer NOT NULL,
	`position` integer NOT NULL,
	`is_corresponding` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`publication_id`, `author_id`),
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pubauthors_author_idx` ON `publication_authors` (`author_id`);--> statement-breakpoint
CREATE TABLE `publications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cite_key` text NOT NULL,
	`entry_type` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`authors_raw` text DEFAULT '' NOT NULL,
	`journal` text,
	`booktitle` text,
	`publisher` text,
	`school` text,
	`institution` text,
	`series` text,
	`edition` text,
	`address` text,
	`volume` text,
	`number` text,
	`pages` text,
	`year` integer NOT NULL,
	`month` text,
	`doi` text,
	`url` text,
	`pdf_url` text,
	`project_url` text,
	`code_url` text,
	`slides_url` text,
	`arxiv_id` text,
	`isbn` text,
	`issn` text,
	`abstract` text,
	`keywords` text,
	`note` text,
	`bibtex_raw` text NOT NULL,
	`ieee_citation` text DEFAULT '' NOT NULL,
	`citation_count` integer DEFAULT 0 NOT NULL,
	`is_featured` integer DEFAULT false NOT NULL,
	`is_published` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_citekey_uq` ON `publications` (`cite_key`);--> statement-breakpoint
CREATE INDEX `publications_year_idx` ON `publications` (`year`);--> statement-breakpoint
CREATE INDEX `publications_category_idx` ON `publications` (`category`);--> statement-breakpoint
CREATE INDEX `publications_featured_idx` ON `publications` (`is_featured`);--> statement-breakpoint
CREATE TABLE `research_interests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`icon` text,
	`is_featured` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `research_sort_idx` ON `research_interests` (`sort_order`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`user_agent` text,
	`ip_address` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`group` text DEFAULT 'general' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skill_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`icon` text,
	`display_mode` text DEFAULT 'bar' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_categories_slug_uq` ON `skill_categories` (`slug`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`level` integer DEFAULT 0 NOT NULL,
	`level_label` text,
	`years_experience` real,
	`description` text,
	`icon` text,
	`url` text,
	`issued_by` text,
	`issued_year` integer,
	`credential_id` text,
	`is_featured` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `skill_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skills_category_idx` ON `skills` (`category_id`);--> statement-breakpoint
CREATE INDEX `skills_featured_idx` ON `skills` (`is_featured`);--> statement-breakpoint
CREATE TABLE `supervised_theses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_name` text NOT NULL,
	`title` text NOT NULL,
	`degree` text NOT NULL,
	`year` integer,
	`institution` text,
	`status` text DEFAULT 'completed' NOT NULL,
	`url` text,
	`is_published` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `theses_degree_year_idx` ON `supervised_theses` (`degree`,`year`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'admin' NOT NULL,
	`avatar_media_id` integer,
	`must_change_password` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_login_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`avatar_media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);