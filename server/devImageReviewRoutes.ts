import type { Express, RequestHandler } from "express";
import type { Multer } from "multer";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { pendingCardImages } from "../shared/schema";
import { db } from "./db";
import { storage } from "./storage";
import { uploadUserCardImage } from "./cloudinary";
import { isDevScanVisualEnabled } from "./services/devScanVisual";
import { assertDevScanTelemetryDatabase } from "./services/devScanTelemetry";
import { validateWrongImageReason } from "./services/cardPhotoReviewPolicy";

export function registerDevImageReviewRoutes(app: Express, auth: RequestHandler, upload: Multer) {
  app.post("/api/cards/:cardId/report-image",
    (_req, res, next) => { if (!isDevScanVisualEnabled()) { res.sendStatus(404); return; } next(); },
    auth, upload.single("frontImage"), async (req: any, res) => {
      try {
        assertDevScanTelemetryDatabase();
        const cardId = Number(req.params.cardId);
        if (!Number.isSafeInteger(cardId) || cardId < 1) return res.status(400).json({ message: "Invalid card" });
        let reason: string;
        try { reason = validateWrongImageReason(req.body.reason); }
        catch { return res.status(400).json({ message: "Choose a valid image-report reason" }); }
        const card = await storage.getCard(cardId);
        if (!card || card.archivedAt) return res.status(404).json({ message: "Card not found" });
        const source = `wrong_image:${reason}`;
        const [existing] = await db.select({ id: pendingCardImages.id }).from(pendingCardImages).where(and(
          eq(pendingCardImages.userId, req.user.id), eq(pendingCardImages.cardId, cardId),
          eq(pendingCardImages.source, source), eq(pendingCardImages.status, "pending")));
        if (existing) return res.status(409).json({ message: "Your report is already awaiting review" });
        let frontImageUrl: string | null = null;
        if (req.file) {
          if (req.file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(req.file.mimetype)) {
            return res.status(400).json({ message: "Use a JPEG, PNG or WebP photo up to 5MB" });
          }
          let buffer: Buffer;
          try {
            buffer = await sharp(req.file.buffer, { limitInputPixels: 40_000_000 }).rotate()
              .resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
          } catch { return res.status(400).json({ message: "The attachment could not be decoded as a photo" }); }
          frontImageUrl = await uploadUserCardImage(buffer, req.user.id, cardId, "front");
        }
        // A report is always pending, including reports made by admins. No ownership write.
        const pendingImage = await storage.createPendingCardImage({
          userId: req.user.id, cardId, source, frontImageUrl, backImageUrl: null,
        });
        res.status(201).json({ success: true, pendingImage, autoApproved: false });
      } catch (error) {
        console.error("[DEV image report]", error);
        res.status(500).json({ message: "The report could not be saved. Try again." });
      }
    });
}