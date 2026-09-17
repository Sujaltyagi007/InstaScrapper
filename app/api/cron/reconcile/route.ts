import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsageCounters } from "@/lib/storage/r2-guardrail";

export const maxDuration = 60; // 1 minute max for cron

export async function POST(req: Request) {
  try {
    // 1. Verify cron secret to prevent unauthorized access
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const accountId = process.env.R2_ACCOUNT_ID?.trim();
    const cfToken = process.env.CF_API_TOKEN?.trim();
    
    if (!accountId || !cfToken) {
      console.warn("[R2 Reconcile Cron] Missing R2_ACCOUNT_ID or CF_API_TOKEN");
      return new NextResponse("Missing Cloudflare credentials", { status: 500 });
    }

    // 2. Query Cloudflare GraphQL Analytics API for R2 usage
    // Cloudflare GraphQL endpoint requires specific structured queries
    // This provides a safety check comparing local DB counters to actual Cloudflare data
    const query = `
      query {
        viewer {
          accounts(filter: { accountTag: "${accountId}" }) {
            r2StorageAdaptiveGroups(limit: 1) {
              sum {
                metadataSize
                payloadSize
              }
            }
            r2OperationsAdaptiveGroups(limit: 10) {
              sum {
                requests
              }
              dimensions {
                actionType
              }
            }
          }
        }
      }
    `;

    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfToken}`
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Cloudflare API responded with status ${response.status}`);
    }

    const data = await response.json();
    
    if (data.errors) {
      throw new Error(`Cloudflare API errors: ${JSON.stringify(data.errors)}`);
    }

    // Parse Cloudflare response
    const accountData = data.data?.viewer?.accounts?.[0];
    const storageStats = accountData?.r2StorageAdaptiveGroups?.[0]?.sum || { payloadSize: 0, metadataSize: 0 };
    const opsStats = accountData?.r2OperationsAdaptiveGroups || [];

    const totalStorageBytes = storageStats.payloadSize + storageStats.metadataSize;
    
    let aClassCount = 0;
    let bClassCount = 0;
    
    for (const group of opsStats) {
      const action = group.dimensions.actionType;
      const requests = group.sum.requests;
      
      // A-Class actions
      if (["PutObject", "ListObjects", "CreateMultipartUpload", "UploadPart", "CompleteMultipartUpload"].includes(action)) {
        aClassCount += requests;
      }
      // B-Class actions
      else if (["GetObject", "HeadObject"].includes(action)) {
        bClassCount += requests;
      }
    }

    // 3. Compare and Sync Local DB
    const counter = await getUsageCounters();
    
    console.log(`[R2 Reconcile] Local Storage: ${counter.storageBytesEst}, CF Actual: ${totalStorageBytes}`);
    console.log(`[R2 Reconcile] Local A-Class: ${counter.aClassOps}, CF Actual: ${aClassCount}`);
    console.log(`[R2 Reconcile] Local B-Class: ${counter.bClassOps}, CF Actual: ${bClassCount}`);
    
    await prisma.r2UsageCounter.updateMany({
      where: { id: "singleton" },
      data: {
        storageBytesEst: totalStorageBytes,
        // For ops, we take the max to ensure we never under-report limits
        aClassOps: Math.max(counter.aClassOps, aClassCount),
        bClassOps: Math.max(counter.bClassOps, bClassCount),
        lastReconciledAt: new Date()
      }
    });

    return NextResponse.json({
      success: true,
      storage: {
        local: Number(counter.storageBytesEst),
        actual: totalStorageBytes
      },
      aClass: {
        local: counter.aClassOps,
        actual: aClassCount
      },
      bClass: {
        local: counter.bClassOps,
        actual: bClassCount
      }
    });
  } catch (error) {
    console.error("[R2 Reconcile Cron] Failed", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
