import { db } from "./db";
import { badges, userBadges, users, messages, friends, cardSets, userCollections, cards } from "../shared/schema";
import { eq, and, count, gte, lte, sql } from "drizzle-orm";

export class BadgeService {
  // List of curse words for Potty Mouth badge
  private readonly curseWords = [
    'damn', 'hell', 'shit', 'fuck', 'ass', 'bitch', 'crap', 'piss', 'bastard', 'bloody'
  ];

  // Check if user has already earned a badge
  async hasUserEarnedBadge(userId: number, badgeId: number): Promise<boolean> {
    const existingBadge = await db.select()
      .from(userBadges)
      .where(and(
        eq(userBadges.userId, userId),
        eq(userBadges.badgeId, badgeId)
      ))
      .limit(1);
    
    return existingBadge.length > 0;
  }

  // Award badge to user
  async awardBadge(userId: number, badgeId: number): Promise<void> {
    const hasEarned = await this.hasUserEarnedBadge(userId, badgeId);
    if (hasEarned) return;

    await db.insert(userBadges).values({
      userId,
      badgeId
    });

    // Get badge details for logging
    const badge = await db.select()
      .from(badges)
      .where(eq(badges.id, badgeId))
      .limit(1);

    if (badge[0]) {
      console.log(`🏆 BADGE EARNED: User ${userId} earned "${badge[0].name}" (${badge[0].rarity})`);
      
      // TODO: Add notification system here
      // This is where you would trigger a notification to the user
      // For now, we'll just log it
    }
  }

  // Get badge by name
  async getBadgeByName(name: string) {
    const badge = await db.select()
      .from(badges)
      .where(eq(badges.name, name))
      .limit(1);
    
    return badge[0] || null;
  }

  // 1. Potty Mouth - Check message for curse words
  async checkPottyMouth(userId: number, messageContent: string): Promise<void> {
    const badge = await this.getBadgeByName('Potty Mouth');
    if (!badge) return;

    const containsCurseWord = this.curseWords.some(word => 
      messageContent.toLowerCase().includes(word.toLowerCase())
    );

    if (containsCurseWord) {
      await this.awardBadge(userId, badge.id);
    }
  }

  // 2. Loyalist - Check subscription payments (placeholder - would need Stripe webhook)
  async checkLoyalist(userId: number): Promise<void> {
    const badge = await this.getBadgeByName('Loyalist');
    if (!badge) return;
    
    // This would be triggered by Stripe webhook on second payment
    // For now, we'll check if user has been subscribed for 2+ months
    const user = await db.select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user[0] && user[0].subscriptionStatus === 'active') {
      const accountAge = new Date().getTime() - new Date(user[0].createdAt).getTime();
      const twoMonthsMs = 2 * 30 * 24 * 60 * 60 * 1000;
      
      if (accountAge >= twoMonthsMs) {
        await this.awardBadge(userId, badge.id);
      }
    }
  }

  // 3. Annual Avenger - Check for annual subscription (placeholder)
  async checkAnnualAvenger(userId: number): Promise<void> {
    const badge = await this.getBadgeByName('Annual Avenger');
    if (!badge) return;
    
    // This would be triggered by Stripe webhook for annual payment
    // Implementation would depend on Stripe subscription metadata
  }

  // 4. Price Checker - Check when user refreshes card price
  async checkPriceChecker(userId: number): Promise<void> {
    const badge = await this.getBadgeByName('Price Checker');
    if (!badge) return;
    
    await this.awardBadge(userId, badge.id);
  }

  // 5. Welcome Back - Check login after 2+ weeks inactivity
  async checkWelcomeBack(userId: number): Promise<void> {
    const badge = await this.getBadgeByName('Welcome Back');
    if (!badge) return;

    const user = await db.select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user[0] && user[0].lastLogin) {
      const lastLogin = new Date(user[0].lastLogin);
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      
      if (lastLogin < twoWeeksAgo) {
        await this.awardBadge(userId, badge.id);
      }
    }
  }

  // 6. Deal Maker - Check for completed trades (placeholder)
  async checkDealMaker(userId: number): Promise<void> {
    const badge = await this.getBadgeByName('Deal Maker');
    if (!badge) return;
    
    // This would be triggered when trade system is implemented
    // For now, this is a placeholder
  }

  // 7. Completionist - Check if user completed all sets from one year
  async checkCompletionist(userId: number): Promise<void> {
    const badge = await this.getBadgeByName('Completionist');
    if (!badge) return;

    // Get all years that have card sets
    const years = await db.select({ year: cardSets.year })
      .from(cardSets)
      .groupBy(cardSets.year);

    for (const yearData of years) {
      const year = yearData.year;
      
      // Get all sets from this year
      const setsFromYear = await db.select()
        .from(cardSets)
        .where(eq(cardSets.year, year));

      // Check if user has completed all sets from this year
      let yearCompleted = true;
      for (const set of setsFromYear) {
        const userCardsInSet = await db.select({ count: count() })
          .from(userCollections)
          .innerJoin(cards, eq(userCollections.cardId, cards.id))
          .where(and(
            eq(userCollections.userId, userId),
            eq(cards.setId, set.id)
          ));

        if (userCardsInSet[0].count < set.totalCards) {
          yearCompleted = false;
          break;
        }
      }

      if (yearCompleted && setsFromYear.length > 0) {
        await this.awardBadge(userId, badge.id);
        return;
      }
    }
  }

  // 8. Hall of Fame - Check if user is in top 10 leaderboard
  async checkHallOfFame(userId: number): Promise<void> {
    const badge = await this.getBadgeByName('Hall of Fame');
    if (!badge) return;

    // Get top 10 users by collection count
    const topUsers = await db.select({
      userId: userCollections.userId,
      count: count(userCollections.id)
    })
    .from(userCollections)
    .groupBy(userCollections.userId)
    .orderBy(sql`count(${userCollections.id}) DESC`)
    .limit(10);

    const isInTop10 = topUsers.some(user => user.userId === userId);
    if (isInTop10) {
      await this.awardBadge(userId, badge.id);
    }
  }

  // 9. Chatty Cathy - Check if user sent 500+ messages
  async checkChattyCathy(userId: number): Promise<void> {
    const badge = await this.getBadgeByName('Chatty Cathy');
    if (!badge) return;

    const messageCount = await db.select({ count: count() })
      .from(messages)
      .where(eq(messages.senderId, userId));

    if (messageCount[0].count >= 500) {
      await this.awardBadge(userId, badge.id);
    }
  }

  // 10. Friendship is Magic - Check if user has 5+ friends for 3+ months
  async checkFriendshipIsMagic(userId: number): Promise<void> {
    const badge = await this.getBadgeByName('Friendship is Magic');
    if (!badge) return;

    const threeMonthsAgo = new Date(Date.now() - 3 * 30 * 24 * 60 * 60 * 1000);
    
    const friendCount = await db.select({ count: count() })
      .from(friends)
      .where(and(
        sql`(${friends.requesterId} = ${userId} OR ${friends.recipientId} = ${userId})`,
        eq(friends.status, 'accepted'),
        lte(friends.createdAt, threeMonthsAgo)
      ));

    if (friendCount[0].count >= 5) {
      await this.awardBadge(userId, badge.id);
    }
  }

  // 11. Nightcrawler - Check 7 consecutive midnight logins
  async checkNightcrawler(userId: number): Promise<void> {
    const badge = await this.getBadgeByName('Nightcrawler');
    if (!badge) return;

    // This would require tracking login times and checking for midnight logins
    // For now, this is a placeholder that would need more detailed login tracking
    
    const user = await db.select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user[0] && user[0].loginStreak >= 7) {
      // Additional logic would be needed to verify these were midnight logins
      // This is a simplified implementation
      const now = new Date();
      if (now.getHours() >= 0 && now.getHours() < 6) {
        await this.awardBadge(userId, badge.id);
      }
    }
  }

  // Run all retroactive badge checks for a user
  async runRetroactiveBadgeChecks(userId: number): Promise<void> {
    await this.checkLoyalist(userId);
    await this.checkCompletionist(userId);
    await this.checkHallOfFame(userId);
    await this.checkChattyCathy(userId);
    await this.checkFriendshipIsMagic(userId);
    await this.checkNightcrawler(userId);
  }

  // Run badge checks when user performs specific actions
  async checkBadgesOnMessage(userId: number, messageContent: string): Promise<void> {
    await this.checkPottyMouth(userId, messageContent);
    await this.checkChattyCathy(userId);
  }

  async checkBadgesOnLogin(userId: number): Promise<void> {
    await this.checkWelcomeBack(userId);
    await this.checkNightcrawler(userId);
  }

  async checkBadgesOnPriceRefresh(userId: number): Promise<void> {
    await this.checkPriceChecker(userId);
  }

  async checkBadgesOnCollectionChange(userId: number): Promise<void> {
    await this.checkCompletionist(userId);
    await this.checkHallOfFame(userId);
  }

  async checkBadgesOnFriendChange(userId: number): Promise<void> {
    await this.checkFriendshipIsMagic(userId);
  }
}

export const badgeService = new BadgeService();