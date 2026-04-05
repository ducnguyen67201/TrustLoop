-- CreateEnum
CREATE TYPE "AnalysisTriggerMode" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "analysisTriggerMode" "AnalysisTriggerMode" NOT NULL DEFAULT 'AUTO';
