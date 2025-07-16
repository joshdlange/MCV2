import { db } from "./db";
import { notifications } from "../shared/schema";
import { eq, and, desc, count } from "drizzle-orm";

export class NotificationService {
  // Create a notification
  async createNotification(
    userId: number,
    type: string,
    title: string,
    message: string,
    data?: any
  ): Promise<void> {
    await db.insert(notifications).values({
      userId,
      type,
      title,
      message,
      data: data ? JSON.stringify(data) : null,
    });
  }

  // Create badge earned notification
  async createBadgeNotification(userId: number, badgeName: string, badgeRarity: string): Promise<void> {
    await this.createNotification(
      userId,
      'badge_earned',
      'New Achievement Unlocked!',
      `You've earned the "${badgeName}" badge! This ${badgeRarity} achievement is now part of your collection.`,
      { badgeName, badgeRarity }
    );
  }

  // Get user's notifications
  async getUserNotifications(userId: number, limit: number = 20): Promise<any[]> {
    return await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  // Get unread notification count
  async getUnreadCount(userId: number): Promise<number> {
    const result = await db
      .select({ count: count() })
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.isRead, false)
      ));
    
    return result[0].count;
  }

  // Mark notification as read
  async markAsRead(notificationId: number): Promise<void> {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, notificationId));
  }

  // Mark all notifications as read for a user
  async markAllAsRead(userId: number): Promise<void> {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.userId, userId));
  }
}

export const notificationService = new NotificationService();