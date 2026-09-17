ALTER TABLE `fragments` RENAME TO `legacy_fragments`;
--> statement-breakpoint
CREATE TABLE `revisions` (
	`archived` integer DEFAULT false NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`ref` text NOT NULL,
	`version` integer NOT NULL,
	CONSTRAINT `revisions_pk` PRIMARY KEY(`ref`, `version`)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `fragments` (
	`archived` integer DEFAULT false NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`ref` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `revisions` (`archived`, `content`, `created_at`, `ref`, `version`)
SELECT 0, `content`, `updated_at`, `id`, 1 FROM `legacy_fragments`;
--> statement-breakpoint
INSERT INTO `fragments` (`archived`, `content`, `created_at`, `ref`, `updated_at`, `version`)
SELECT 0, `content`, `created_at`, `id`, `updated_at`, 1 FROM `legacy_fragments`;
--> statement-breakpoint
DROP TABLE `legacy_fragments`;
