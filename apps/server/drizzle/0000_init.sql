CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`title` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_token_hash_unique` ON `groups` (`token_hash`);--> statement-breakpoint
CREATE TABLE `members` (
	`group_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`group_id`, `id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`seq` integer NOT NULL,
	`created_seq` integer NOT NULL,
	`content` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `operations_changes` ON `operations` (`group_id`,`seq`);--> statement-breakpoint
CREATE TABLE `revisions` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`revision_id` text NOT NULL,
	`group_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`content` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revisions_revision_id_unique` ON `revisions` (`revision_id`);