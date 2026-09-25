CREATE TABLE `jwks` (
	`alg` text,
	`createdAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`crv` text,
	`expiresAt` integer,
	`id` text PRIMARY KEY,
	`privateKey` text NOT NULL,
	`publicKey` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauthAccessToken` (
	`authorizationCodeId` text,
	`clientId` text NOT NULL,
	`confirmation` text,
	`createdAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expiresAt` integer,
	`id` text PRIMARY KEY,
	`referenceId` text,
	`refreshId` text,
	`requestedUserInfoClaims` text,
	`resources` text,
	`revoked` integer,
	`scopes` text NOT NULL,
	`sessionId` text,
	`token` text UNIQUE,
	`userId` text,
	CONSTRAINT `fk_oauthAccessToken_clientId_oauthClient_clientId_fk` FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauthAccessToken_refreshId_oauthRefreshToken_id_fk` FOREIGN KEY (`refreshId`) REFERENCES `oauthRefreshToken`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauthAccessToken_sessionId_session_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `session`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_oauthAccessToken_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauthClient` (
	`applicationType` text,
	`backchannelLogoutSessionRequired` integer,
	`backchannelLogoutUri` text,
	`clientCredentialsScopes` text,
	`clientDiscoveryId` text,
	`clientId` text NOT NULL UNIQUE,
	`clientSecret` text,
	`contacts` text,
	`createdAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`disabled` integer DEFAULT false,
	`dpopBoundAccessTokens` integer DEFAULT false,
	`enableEndSession` integer,
	`grantTypes` text,
	`icon` text,
	`id` text PRIMARY KEY,
	`jwks` text,
	`jwksUri` text,
	`metadata` text,
	`name` text,
	`policy` text,
	`postLogoutRedirectUris` text,
	`redirectUris` text NOT NULL,
	`referenceId` text,
	`requirePKCE` integer,
	`responseTypes` text,
	`scopes` text,
	`skipConsent` integer,
	`softwareId` text,
	`softwareStatement` text,
	`softwareVersion` text,
	`subjectType` text,
	`tokenEndpointAuthMethod` text,
	`tos` text,
	`updatedAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`uri` text,
	`userId` text,
	CONSTRAINT `fk_oauthClient_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauthClientAssertion` (
	`expiresAt` integer NOT NULL,
	`id` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `oauthClientResource` (
	`clientId` text NOT NULL,
	`createdAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`id` text PRIMARY KEY,
	`metadata` text,
	`resourceId` text NOT NULL,
	CONSTRAINT `fk_oauthClientResource_clientId_oauthClient_clientId_fk` FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauthClientResource_resourceId_oauthResource_identifier_fk` FOREIGN KEY (`resourceId`) REFERENCES `oauthResource`(`identifier`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauthConsent` (
	`clientId` text NOT NULL,
	`createdAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`id` text PRIMARY KEY,
	`referenceId` text,
	`requestedUserInfoClaims` text,
	`resources` text,
	`scopes` text NOT NULL,
	`updatedAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`userId` text,
	CONSTRAINT `fk_oauthConsent_clientId_oauthClient_clientId_fk` FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauthConsent_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauthRefreshToken` (
	`authTime` integer,
	`authorizationCodeId` text,
	`clientId` text NOT NULL,
	`confirmation` text,
	`createdAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expiresAt` integer,
	`id` text PRIMARY KEY,
	`referenceId` text,
	`requestedUserInfoClaims` text,
	`resources` text,
	`revoked` integer,
	`rotatedAt` integer,
	`rotationReplayExpiresAt` integer,
	`rotationReplayResponse` text,
	`scopes` text NOT NULL,
	`sessionId` text,
	`token` text NOT NULL UNIQUE,
	`userId` text NOT NULL,
	CONSTRAINT `fk_oauthRefreshToken_clientId_oauthClient_clientId_fk` FOREIGN KEY (`clientId`) REFERENCES `oauthClient`(`clientId`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauthRefreshToken_sessionId_session_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `session`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_oauthRefreshToken_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauthResource` (
	`accessTokenTtl` integer,
	`allowedScopes` text,
	`createdAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`customClaims` text,
	`disabled` integer DEFAULT false,
	`dpopBoundAccessTokensRequired` integer DEFAULT false,
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL UNIQUE,
	`metadata` text,
	`name` text NOT NULL,
	`policyVersion` integer DEFAULT 1,
	`refreshTokenTtl` integer,
	`signingAlgorithm` text,
	`signingKeyId` text,
	`updatedAt` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauthAccessToken_authorizationCodeId_idx` ON `oauthAccessToken` (`authorizationCodeId`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_clientId_idx` ON `oauthAccessToken` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_refreshId_idx` ON `oauthAccessToken` (`refreshId`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_sessionId_idx` ON `oauthAccessToken` (`sessionId`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_userId_idx` ON `oauthAccessToken` (`userId`);--> statement-breakpoint
CREATE INDEX `oauthClient_userId_idx` ON `oauthClient` (`userId`);--> statement-breakpoint
CREATE INDEX `oauthClientResource_clientId_idx` ON `oauthClientResource` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauthClientResource_resourceId_idx` ON `oauthClientResource` (`resourceId`);--> statement-breakpoint
CREATE INDEX `oauthConsent_clientId_idx` ON `oauthConsent` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauthConsent_userId_idx` ON `oauthConsent` (`userId`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_authorizationCodeId_idx` ON `oauthRefreshToken` (`authorizationCodeId`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_clientId_idx` ON `oauthRefreshToken` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_sessionId_idx` ON `oauthRefreshToken` (`sessionId`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_userId_idx` ON `oauthRefreshToken` (`userId`);