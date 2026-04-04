-- Rename payloadJson to rawPayloadJson on SupportIngressEvent
ALTER TABLE "SupportIngressEvent" RENAME COLUMN "payloadJson" TO "rawPayloadJson";
