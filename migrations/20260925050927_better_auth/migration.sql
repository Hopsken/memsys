CREATE TABLE `account` (
	`accessToken` text,
	`accessTokenExpiresAt` integer,
	`accountId` text NOT NULL,
	`createdAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`id` text PRIMARY KEY,
	`idToken` text,
	`password` text,
	`providerId` text NOT NULL,
	`refreshToken` text,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`updatedAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`userId` text NOT NULL,
	CONSTRAINT `fk_account_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `apikey` (
	`configId` text DEFAULT 'default' NOT NULL,
	`createdAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`enabled` integer DEFAULT true,
	`expiresAt` integer,
	`id` text PRIMARY KEY,
	`key` text NOT NULL,
	`lastRefillAt` integer,
	`lastRequest` integer,
	`metadata` text,
	`name` text,
	`permissions` text,
	`prefix` text,
	`rateLimitEnabled` integer DEFAULT true,
	`rateLimitMax` integer,
	`rateLimitTimeWindow` integer,
	`referenceId` text NOT NULL,
	`refillAmount` integer,
	`refillInterval` integer,
	`remaining` integer,
	`requestCount` integer DEFAULT 0,
	`start` text,
	`updatedAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_apikey_referenceId_user_id_fk` FOREIGN KEY (`referenceId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `rateLimit` (
	`count` integer NOT NULL,
	`id` text PRIMARY KEY,
	`key` text NOT NULL UNIQUE,
	`lastRequest` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`createdAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expiresAt` integer NOT NULL,
	`id` text PRIMARY KEY,
	`ipAddress` text,
	`token` text NOT NULL UNIQUE,
	`updatedAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`userAgent` text,
	`userId` text NOT NULL,
	CONSTRAINT `fk_session_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user` (
	`createdAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`email` text NOT NULL UNIQUE,
	`emailVerified` integer DEFAULT false NOT NULL,
	`id` text PRIMARY KEY,
	`image` text,
	`name` text NOT NULL,
	`updatedAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`createdAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expiresAt` integer NOT NULL,
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`updatedAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE INDEX `apikey_key_idx` ON `apikey` (`key`);--> statement-breakpoint
CREATE INDEX `apikey_referenceId_idx` ON `apikey` (`referenceId`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);