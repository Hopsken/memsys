CREATE TABLE `__new_records` (
	`createdAt` integer DEFAULT (cast(round(unixepoch('subsecond') * 1000) as integer)) NOT NULL,
	`fragment` text,
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`op` text NOT NULL,
	`ref` text NOT NULL,
	`source` text
);
--> statement-breakpoint
-- Rebuild in old timestamp order so ids carry the order the log already had,
-- assign them explicitly, and keep each record's op and source.
INSERT INTO `__new_records`(`id`, `ref`, `fragment`, `op`, `source`, `createdAt`)
	SELECT ROW_NUMBER() OVER (ORDER BY `at`, `ref`), `ref`, `fragment`, `op`, `source`, `at` FROM `records`;
--> statement-breakpoint
DROP TABLE `records`;
--> statement-breakpoint
ALTER TABLE `__new_records` RENAME TO `records`;
--> statement-breakpoint
CREATE INDEX `records_created_at_id_idx` ON `records` (`createdAt`,`id`);
--> statement-breakpoint
CREATE INDEX `records_ref_id_idx` ON `records` (`ref`,`id`);
--> statement-breakpoint
-- Snapshot cutoffs were epoch milliseconds; ids start again at 1.
DELETE FROM `metadata` WHERE `key` = 'logCursor';
