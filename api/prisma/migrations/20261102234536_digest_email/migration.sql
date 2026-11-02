-- AlterTable
ALTER TABLE "Digest" ADD COLUMN     "emailedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DigestSetting" ADD COLUMN     "email" BOOLEAN NOT NULL DEFAULT false;
