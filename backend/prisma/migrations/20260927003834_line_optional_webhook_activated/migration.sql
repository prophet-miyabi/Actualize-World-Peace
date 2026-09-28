-- AlterTable
ALTER TABLE "LineConfig" ADD COLUMN     "webhookActivated" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "channelId" DROP NOT NULL,
ALTER COLUMN "channelSecret" DROP NOT NULL,
ALTER COLUMN "channelAccessToken" DROP NOT NULL;
