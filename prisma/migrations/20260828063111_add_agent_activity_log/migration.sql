-- CreateEnum
CREATE TYPE "AgentActivityType" AS ENUM ('quota_change', 'offline', 'online');

-- CreateTable
CREATE TABLE "agent_activity_logs" (
    "id" SERIAL NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "type" "AgentActivityType" NOT NULL,
    "old_value" INTEGER,
    "new_value" INTEGER,
    "changed_by" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_activity_logs_agent_id_occurred_at_idx" ON "agent_activity_logs"("agent_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "agent_activity_logs" ADD CONSTRAINT "agent_activity_logs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
