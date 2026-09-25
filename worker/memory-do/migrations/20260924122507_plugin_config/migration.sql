CREATE TABLE `plugin_config` (
	`config` text NOT NULL,
	`enabled` integer NOT NULL,
	`name` text PRIMARY KEY,
	`updated_at` integer NOT NULL
);
