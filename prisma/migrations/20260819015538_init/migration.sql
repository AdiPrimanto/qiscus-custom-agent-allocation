-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('waiting', 'assigned', 'resolved');

-- CreateTable
CREATE TABLE "agents" (
    "id" SERIAL NOT NULL,
    "qiscus_agent_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "max_concurrent" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" SERIAL NOT NULL,
    "room_id" TEXT NOT NULL,
    "customer_identifier" TEXT NOT NULL,
    "agent_id" INTEGER,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'waiting',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_qiscus_agent_id_key" ON "agents"("qiscus_agent_id");

-- CreateIndex
CREATE INDEX "assignments_status_created_at_idx" ON "assignments"("status", "created_at");

-- CreateIndex
CREATE INDEX "assignments_room_id_idx" ON "assignments"("room_id");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
