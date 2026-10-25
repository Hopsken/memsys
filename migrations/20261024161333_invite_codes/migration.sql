CREATE TABLE `inviteCode` (
	`code` text PRIMARY KEY,
	`createdAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expiresAt` integer NOT NULL,
	`maxUses` integer NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL
);
