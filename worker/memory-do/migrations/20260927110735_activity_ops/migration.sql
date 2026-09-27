CREATE TABLE `__new_records` (
	`at` integer NOT NULL,
	`by` text,
	`fragment` text,
	`op` text NOT NULL,
	`ref` text NOT NULL,
	CONSTRAINT `records_pk` PRIMARY KEY(`ref`, `at`)
);
--> statement-breakpoint
-- Each earlier record gets the op its place in its ref's log implies; who
-- wrote it is unknown.
INSERT INTO `__new_records` (`at`, `by`, `fragment`, `op`, `ref`)
	SELECT `at`, NULL, `fragment`,
		CASE
			WHEN `fragment` IS NULL THEN 'forget'
			WHEN `position` = 1 THEN 'remember'
			WHEN `previous` IS NULL THEN 'restore'
			ELSE 'revise'
		END,
		`ref`
	FROM (
		SELECT `at`, `fragment`, `ref`,
			ROW_NUMBER() OVER (PARTITION BY `ref` ORDER BY `at`) AS `position`,
			LAG(`fragment`) OVER (PARTITION BY `ref` ORDER BY `at`) AS `previous`
		FROM `records`
	);
--> statement-breakpoint
DROP TABLE `records`;
--> statement-breakpoint
ALTER TABLE `__new_records` RENAME TO `records`;
--> statement-breakpoint
CREATE INDEX `records_at_ref_idx` ON `records` (`at`,`ref`);
