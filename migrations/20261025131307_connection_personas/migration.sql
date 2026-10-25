CREATE TABLE `connectionPersonas` (
	`connection` text NOT NULL,
	`personaId` text NOT NULL,
	`userId` text NOT NULL,
	CONSTRAINT `connectionPersonas_pk` PRIMARY KEY(`userId`, `connection`),
	CONSTRAINT `fk_connectionPersonas_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
