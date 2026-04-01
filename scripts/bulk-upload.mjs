#!/usr/bin/env node
/**
 * Bulk upload series from CSV + ~/Desktop/script/output/ to Firebase
 * Only uploads series listed in the CSV that have audio data in output/
 * Usage: node scripts/bulk-upload.mjs [--dry-run] [--limit N] [--clean]
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { createReadStream } from "fs";
import crypto from "crypto";

const OUTPUT_DIR = join(process.env.HOME, "Desktop/script/output");
const CSV_PATH = join(process.env.HOME, "Downloads/シャドーイングアプリ課題選定シート - 本決定② (1).csv");
const PROJECT_ID = "starlit-system-465107-g7";
const BUCKET = "starlit-system-465107-g7.firebasestorage.app";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CLEAN = args.includes("--clean");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : Infinity;

initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });
const db = getFirestore();
const bucket = getStorage().bucket();

// Simple CSV parser (handles quoted fields with commas/newlines)
function parseCSV(text) {
  const rows = [];
  let current = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        current.push(field);
        field = "";
      } else if (ch === '\n') {
        current.push(field);
        field = "";
        if (current.length > 1) rows.push(current);
        current = [];
      } else if (ch !== '\r') {
        field += ch;
      }
    }
  }
  if (field || current.length) {
    current.push(field);
    if (current.length > 1) rows.push(current);
  }
  return rows;
}

async function loadCSV() {
  const text = await readFile(CSV_PATH, "utf-8");
  const rows = parseCSV(text);
  const headers = rows[0];
  const noIdx = headers.indexOf("No");
  const assigneeIdx = headers.indexOf("担当者");
  const statusIdx = headers.indexOf("ステータス");
  // There are two "コンテンツタイトル" columns, use first one (index 8)
  const titleIdx = headers.indexOf("コンテンツタイトル");
  const speakerIdx = headers.indexOf("スピーカー");

  const map = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const no = row[noIdx]?.trim();
    if (!no) continue;
    map.set(no, {
      title: row[titleIdx]?.trim() || `Series ${no}`,
      assignee: row[assigneeIdx]?.trim() || "",
      csvStatus: row[statusIdx]?.trim() || "",
      speaker: row[speakerIdx]?.trim() || "",
    });
  }
  return map;
}

async function cleanExisting() {
  console.log("Cleaning existing series docs...");
  const snap = await db.collection("series").get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  console.log(`  Deleted ${snap.size} docs`);
}

async function main() {
  const csvData = await loadCSV();
  console.log(`CSV: ${csvData.size} series listed`);

  if (CLEAN) {
    await cleanExisting();
  }

  const dirs = (await readdir(OUTPUT_DIR)).sort((a, b) => parseInt(a) - parseInt(b));
  const csvNos = new Set(csvData.keys());

  // Filter: only dirs that are in the CSV
  const targetDirs = dirs.filter((d) => csvNos.has(d));
  console.log(`output/ folders matching CSV: ${targetDirs.length}`);

  let uploaded = 0;
  let skipped = 0;

  for (const dir of targetDirs) {
    if (uploaded >= LIMIT) break;

    const seriesPath = join(OUTPUT_DIR, dir);
    const s = await stat(seriesPath);
    if (!s.isDirectory()) continue;

    const audioPath = join(seriesPath, "audio.mp3");
    const jsonPath = join(seriesPath, "aligned_pairs.json");

    try {
      await stat(audioPath);
      await stat(jsonPath);
    } catch {
      console.log(`  SKIP ${dir} - missing audio.mp3 or aligned_pairs.json`);
      skipped++;
      continue;
    }

    // Check if already exists
    if (!CLEAN) {
      const existing = await db.collection("series").doc(dir).get();
      if (existing.exists) {
        console.log(`  SKIP ${dir} - already exists`);
        skipped++;
        continue;
      }
    }

    // Parse JSON
    const jsonText = await readFile(jsonPath, "utf-8");
    let pairs;
    try {
      pairs = JSON.parse(jsonText);
    } catch {
      console.log(`  SKIP ${dir} - invalid JSON`);
      skipped++;
      continue;
    }

    const segments = detectSegments(pairs);
    let daysSegments = null;
    try {
      const daysText = await readFile(join(seriesPath, "days_audio_whisper.txt"), "utf-8");
      const lastEnd = pairs.length > 0 ? pairs[pairs.length - 1].end : 0;
      daysSegments = parseDaysFile(daysText, pairs, lastEnd);
    } catch { /* no days file */ }

    const meta = csvData.get(dir);
    const title = meta?.title || `Series ${dir}`;
    const assignee = meta?.assignee || "";

    if (DRY_RUN) {
      console.log(`  DRY ${dir} - "${title}" @${assignee} - ${pairs.length} pairs, ${(daysSegments || segments).length} segs`);
      uploaded++;
      continue;
    }

    // Upload audio
    const storagePath = `audio/${dir}/audio.mp3`;
    console.log(`  UPLOAD ${dir} - "${title}" ...`);
    await bucket.upload(audioPath, {
      destination: storagePath,
      metadata: { contentType: "audio/mpeg" },
    });

    // Get token-protected download URL
    const file = bucket.file(storagePath);
    const [fileMeta] = await file.getMetadata();
    const token = fileMeta.metadata?.firebaseStorageDownloadTokens || crypto.randomUUID();
    if (!fileMeta.metadata?.firebaseStorageDownloadTokens) {
      await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
    }
    const encodedPath = encodeURIComponent(storagePath);
    const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodedPath}?alt=media&token=${token}`;

    await db.collection("series").doc(dir).set({
      title,
      status: "pending",
      assignee,
      speaker: meta?.speaker || "",
      audioPath: storagePath,
      audioUrl: url,
      pairs,
      segments: daysSegments || segments,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    console.log(`  OK ${dir} - ${pairs.length} pairs, ${(daysSegments || segments).length} segs`);
    uploaded++;
  }

  console.log(`\nDone: ${uploaded} uploaded, ${skipped} skipped`);
}

function detectSegments(pairs) {
  if (pairs.length === 0) return [];
  const totalDur = pairs[pairs.length - 1].end - pairs[0].start;
  const targetDays = Math.max(1, Math.round(totalDur / 37));
  if (targetDays <= 1) return [{ start: pairs[0].start, end: pairs[pairs.length - 1].end }];
  const idealDur = totalDur / targetDays;
  const bounds = [pairs[0].start];
  let nextTarget = pairs[0].start + idealDur;
  for (let i = 1; i < pairs.length; i++) {
    if (pairs[i].start >= nextTarget - idealDur * 0.3) {
      bounds.push(pairs[i].start);
      nextTarget = pairs[i].start + idealDur;
    }
  }
  return bounds.map((b, i) => ({
    start: b,
    end: i < bounds.length - 1 ? bounds[i + 1] : pairs[pairs.length - 1].end,
  }));
}

function parseDaysFile(text, pairs, duration) {
  const regex = /(?:課題|DAY)\d+\s*(?:　| )Audio\n(\d+):(\d+)〜/gi;
  const bounds = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const sec = parseInt(match[1]) * 60 + parseInt(match[2]);
    let closest = 0;
    let minDist = Infinity;
    for (const p of pairs) {
      const dist = Math.abs(p.start - sec);
      if (dist < minDist) { minDist = dist; closest = p.start; }
    }
    bounds.push(closest);
  }
  if (bounds.length === 0) return null;
  const lastEnd = pairs.length > 0 ? pairs[pairs.length - 1].end : duration;
  return bounds.map((b, i) => ({
    start: b,
    end: i < bounds.length - 1 ? bounds[i + 1] : lastEnd,
  }));
}

main().catch(console.error);
