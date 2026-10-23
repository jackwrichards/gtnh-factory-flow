import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { BOARD_IMAGE_MAX_BYTES } from "@/lib/community/types";
import {
  checkRateLimit,
  getCommunityDb,
  isCommunityConfigured,
  addressKey,
} from "@/lib/server/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Board image uploads. Anyone can put a picture on their board, so this is
 * anonymous like voting: rate-limited per actor, size-capped, and the bytes
 * are sniffed rather than trusting the client's content type. Files land in a
 * public Supabase Storage bucket and come back as a plain URL the annotation
 * carries; the plan itself stays small.
 */

const BUCKET = "board-images";
const UPLOADS_PER_HOUR = 30;

/** Magic-byte sniffing: the four image formats browsers render everywhere. */
function sniffImageType(bytes: Uint8Array): { contentType: string; ext: string } | undefined {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return { contentType: "image/png", ext: "png" };
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", ext: "jpg" };
  }
  if (bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { contentType: "image/gif", ext: "gif" };
  }
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { contentType: "image/webp", ext: "webp" };
  }
  return undefined;
}

let bucketReady = false;

/** First upload creates the bucket; every later one costs one cheap check. */
async function ensureBucket(): Promise<void> {
  if (bucketReady) {
    return;
  }
  const db = getCommunityDb();
  const { data } = await db.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await db.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: BOARD_IMAGE_MAX_BYTES,
    });
    if (error && !/already exists/i.test(error.message)) {
      throw new Error(`Image storage bucket could not be created: ${error.message}`);
    }
  }
  bucketReady = true;
}

export async function POST(request: Request) {
  if (!isCommunityConfigured()) {
    return NextResponse.json({ error: "Image hosting is not configured." }, { status: 503 });
  }

  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "No image in the upload." }, { status: 400 });
    }
    if (file.size > BOARD_IMAGE_MAX_BYTES) {
      return NextResponse.json(
        { error: "That image is too big: the limit is 4 MB." },
        { status: 413 },
      );
    }

    const actorKey = addressKey(request);
    if (!(await checkRateLimit(actorKey, "image_upload", UPLOADS_PER_HOUR, 3600))) {
      return NextResponse.json(
        { error: "Too many image uploads: try again in a little while." },
        { status: 429 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffImageType(bytes);
    if (!sniffed) {
      return NextResponse.json(
        { error: "Only PNG, JPEG, GIF and WebP images can go on the board." },
        { status: 415 },
      );
    }

    await ensureBucket();
    const db = getCommunityDb();
    const path = `${new Date().toISOString().slice(0, 7)}/${randomBytes(9).toString("hex")}.${sniffed.ext}`;
    const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: sniffed.contentType,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) {
      return NextResponse.json(
        { error: `Image upload failed: ${error.message}` },
        { status: 500 },
      );
    }

    const { data } = db.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Image upload failed." },
      { status: 500 },
    );
  }
}
