CREATE TABLE `subscriptions` (
	`group_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`member_id` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	PRIMARY KEY(`group_id`, `endpoint`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `subscriptions_members` ON `subscriptions` (`group_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_endpoint` ON `subscriptions` (`endpoint`);