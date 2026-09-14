-- CreateEnum
CREATE TYPE "MetaConnectionStatus" AS ENUM ('ACTIVE', 'REAUTH_REQUIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "TargetAccountType" AS ENUM ('BUSINESS', 'CREATOR', 'PERSONAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TargetEligibility" AS ENUM ('SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'PRIVATE_UNAVAILABLE', 'TEMPORARILY_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "TargetStatus" AS ENUM ('DISCOVERED', 'ACTIVE', 'PAUSED', 'RATE_LIMITED', 'BACKOFF', 'AUTH_ERROR', 'REAUTH_REQUIRED', 'NOT_FOUND', 'UNAVAILABLE', 'UNSUPPORTED', 'INVALID');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('NEW_MEDIA', 'MEDIA_UPDATED', 'PROFILE_CHANGED', 'FOLLOWER_COUNT_CHANGED', 'FOLLOWING_COUNT_CHANGED', 'NEW_STORY', 'NEW_REEL', 'FOLLOWER_CHURN', 'COLLAB_POST_LEAKED', 'ACCOUNT_UNAVAILABLE', 'ACCOUNT_RENAMED', 'RATE_LIMITED', 'SESSION_FLAGGED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationProvider" AS ENUM ('DISCORD', 'NTFY', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'RETRYING');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('TARGET_CHECK', 'NOTIFICATION_DISPATCH', 'RETENTION_CLEANUP');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "emailVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'meta',
    "externalUserId" TEXT NOT NULL,
    "accountType" TEXT,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedTokenIv" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" "MetaConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "targets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "normalizedUsername" TEXT NOT NULL,
    "externalId" TEXT,
    "accountType" "TargetAccountType" NOT NULL DEFAULT 'UNKNOWN',
    "eligibility" "TargetEligibility" NOT NULL DEFAULT 'UNSUPPORTED',
    "status" "TargetStatus" NOT NULL DEFAULT 'DISCOVERED',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instagram_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "authMethod" TEXT NOT NULL DEFAULT 'COOKIE_IMPORT',
    "encryptedCookies" TEXT NOT NULL,
    "encryptedCookiesIv" TEXT NOT NULL,
    "userAgent" TEXT,
    "impersonateTarget" TEXT NOT NULL DEFAULT 'auto',
    "proxyUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastTestedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instagram_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitors" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "engineType" TEXT NOT NULL DEFAULT 'STEALTH_SCRAPER',
    "watchNewMedia" BOOLEAN NOT NULL DEFAULT true,
    "watchProfile" BOOLEAN NOT NULL DEFAULT true,
    "watchFollowerCount" BOOLEAN NOT NULL DEFAULT false,
    "watchFollowingCount" BOOLEAN NOT NULL DEFAULT false,
    "watchStories" BOOLEAN NOT NULL DEFAULT true,
    "watchReels" BOOLEAN NOT NULL DEFAULT true,
    "watchFollowerChurn" BOOLEAN NOT NULL DEFAULT false,
    "watchCollabPosts" BOOLEAN NOT NULL DEFAULT true,
    "jitterEnabled" BOOLEAN NOT NULL DEFAULT true,
    "humanSimEnabled" BOOLEAN NOT NULL DEFAULT false,
    "restrictedHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
    "restrictedHoursStart" INTEGER NOT NULL DEFAULT 8,
    "restrictedHoursEnd" INTEGER NOT NULL DEFAULT 23,
    "instagramSessionId" TEXT,
    "followerThreshold" INTEGER,
    "intervalSeconds" INTEGER NOT NULL DEFAULT 5400,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notificationChannelIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target_snapshots" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "username" TEXT NOT NULL,
    "name" TEXT,
    "biography" TEXT,
    "website" TEXT,
    "profilePictureUrl" TEXT,
    "followersCount" INTEGER,
    "followsCount" INTEGER,
    "mediaCount" INTEGER,
    "reelsCount" INTEGER,
    "hasStory" BOOLEAN NOT NULL DEFAULT false,
    "storiesCount" INTEGER,
    "latestMediaId" TEXT,
    "latestMediaTimestamp" TIMESTAMP(3),
    "followersListHash" TEXT,
    "followingListHash" TEXT,
    "rawHash" TEXT NOT NULL,

    CONSTRAINT "target_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "externalMediaId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "permalink" TEXT,
    "timestamp" TIMESTAMP(3),
    "caption" TEXT,
    "mediaUrl" TEXT,
    "videoUrl" TEXT,
    "isStory" BOOLEAN NOT NULL DEFAULT false,
    "isCollab" BOOLEAN NOT NULL DEFAULT false,
    "collaborators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_channels" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "NotificationProvider" NOT NULL,
    "encryptedConfig" TEXT NOT NULL,
    "encryptedConfigIv" TEXT NOT NULL,
    "eventTypeFilter" "EventType"[],
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "provider" "NotificationProvider" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "targetId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "resultSummary" TEXT,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMP(3),

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "meta_connections_userId_idx" ON "meta_connections"("userId");

-- CreateIndex
CREATE INDEX "targets_userId_idx" ON "targets"("userId");

-- CreateIndex
CREATE INDEX "targets_status_nextRunAt_idx" ON "targets"("status", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "targets_userId_normalizedUsername_key" ON "targets"("userId", "normalizedUsername");

-- CreateIndex
CREATE INDEX "instagram_sessions_userId_idx" ON "instagram_sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "monitors_targetId_key" ON "monitors"("targetId");

-- CreateIndex
CREATE INDEX "monitors_instagramSessionId_idx" ON "monitors"("instagramSessionId");

-- CreateIndex
CREATE INDEX "target_snapshots_targetId_capturedAt_idx" ON "target_snapshots"("targetId", "capturedAt");

-- CreateIndex
CREATE INDEX "media_targetId_idx" ON "media"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "media_targetId_externalMediaId_key" ON "media"("targetId", "externalMediaId");

-- CreateIndex
CREATE INDEX "events_userId_detectedAt_idx" ON "events"("userId", "detectedAt");

-- CreateIndex
CREATE INDEX "events_targetId_detectedAt_idx" ON "events"("targetId", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "events_targetId_fingerprint_key" ON "events"("targetId", "fingerprint");

-- CreateIndex
CREATE INDEX "notification_channels_userId_idx" ON "notification_channels"("userId");

-- CreateIndex
CREATE INDEX "notifications_status_nextAttemptAt_idx" ON "notifications"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "notifications_channelId_idx" ON "notifications"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_eventId_channelId_key" ON "notifications"("eventId", "channelId");

-- CreateIndex
CREATE INDEX "jobs_type_status_runAt_idx" ON "jobs"("type", "status", "runAt");

-- CreateIndex
CREATE INDEX "jobs_targetId_idx" ON "jobs"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_rate_limits_key_key" ON "auth_rate_limits"("key");

-- AddForeignKey
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "targets" ADD CONSTRAINT "targets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_sessions" ADD CONSTRAINT "instagram_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_instagramSessionId_fkey" FOREIGN KEY ("instagramSessionId") REFERENCES "instagram_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_snapshots" ADD CONSTRAINT "target_snapshots_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_rate_limits" ADD CONSTRAINT "auth_rate_limits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
