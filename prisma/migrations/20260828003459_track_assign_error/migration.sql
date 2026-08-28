-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "last_assign_error_at" TIMESTAMP(3),
ADD COLUMN     "last_assign_error_status" INTEGER;
