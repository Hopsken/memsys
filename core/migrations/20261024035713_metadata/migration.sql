CREATE TABLE `metadata` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
-- Carries the owner's plugin choices over as the Worker's settings. Only
-- fields the owner changed are written; the rest follow the defaults. A
-- disabled size-limit becomes limits at the core ceiling; the relevance
-- filter is on only where jev was.
INSERT INTO `metadata` (`key`, `value`)
SELECT
	'settings',
	json_patch(
		CASE
			WHEN `size`.`name` IS NULL THEN '{}'
			WHEN `size`.`enabled` THEN json_object('length', json_object(
				'refuse', json_extract(`size`.`config`, '$.hard'),
				'warn', json_extract(`size`.`config`, '$.soft')
			))
			ELSE json_object('length', json_object('refuse', 1000, 'warn', 1000))
		END,
		CASE
			WHEN `jev`.`name` IS NULL THEN '{}'
			WHEN `jev`.`enabled` THEN json_object('relevanceFilter',
				coalesce(json_extract(`jev`.`config`, '$.strictness'), 'medium'))
			ELSE json_object('relevanceFilter', 'off')
		END
	)
FROM (SELECT 1) AS `one`
LEFT JOIN `plugin_config` AS `size` ON `size`.`name` = 'size-limit'
LEFT JOIN `plugin_config` AS `jev` ON `jev`.`name` = 'jev'
WHERE `size`.`name` IS NOT NULL OR `jev`.`name` IS NOT NULL;
--> statement-breakpoint
DROP TABLE `plugin_config`;
