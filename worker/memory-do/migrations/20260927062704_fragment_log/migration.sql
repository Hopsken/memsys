CREATE TABLE `records` (
	`at` integer NOT NULL,
	`fragment` text,
	`ref` text NOT NULL,
	CONSTRAINT `records_pk` PRIMARY KEY(`ref`, `at`)
);
--> statement-breakpoint
-- Each fragment's current text becomes its first record, written at updated_at.
INSERT INTO `records` (`ref`, `fragment`, `at`)
	SELECT `id`, `content`, `updated_at` FROM `fragments` ORDER BY `updated_at`, `id`;
--> statement-breakpoint
DROP TABLE `fragments`;
