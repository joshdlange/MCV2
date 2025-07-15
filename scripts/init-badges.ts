import { db } from "../server/db";
import { badges } from "../shared/schema";

const marvelBadges = [
  // Collection Badges
  {
    name: "Rookie Collector",
    description: "Welcome to the Marvel universe! Added your first card to the vault.",
    category: "Collection",
    requirement: JSON.stringify({ type: "collection_count", value: 1 }),
    rarity: "bronze",
    points: 10,
    unlockHint: "Add your first card to your collection"
  },
  {
    name: "Hundred Club",
    description: "A true collector emerges! Added 100 cards to your vault.",
    category: "Collection", 
    requirement: JSON.stringify({ type: "collection_count", value: 100 }),
    rarity: "silver",
    points: 25,
    unlockHint: "Collect 100 cards"
  },
  {
    name: "Insert Hunter",
    description: "Rare finds specialist! Collected 10 insert cards.",
    category: "Collection",
    requirement: JSON.stringify({ type: "insert_count", value: 10 }),
    rarity: "gold",
    points: 50,
    unlockHint: "Collect 10 insert cards"
  },
  {
    name: "Set Completer",
    description: "Perfectionist collector! Completed your first full set.",
    category: "Collection",
    requirement: JSON.stringify({ type: "completed_sets", value: 1 }),
    rarity: "gold",
    points: 75,
    unlockHint: "Complete any full card set"
  },
  {
    name: "Master Collector",
    description: "Legendary status achieved! Completed 5 full sets.",
    category: "Collection",
    requirement: JSON.stringify({ type: "completed_sets", value: 5 }),
    rarity: "platinum",
    points: 150,
    unlockHint: "Complete 5 full card sets"
  },
  {
    name: "Vault Guardian",
    description: "Massive collection mastery! Added 1000 cards to your vault.",
    category: "Collection",
    requirement: JSON.stringify({ type: "collection_count", value: 1000 }),
    rarity: "platinum",
    points: 200,
    unlockHint: "Collect 1000 cards"
  },

  // Social Badges
  {
    name: "Friendly Face",
    description: "Social hero activated! Added your first friend.",
    category: "Social",
    requirement: JSON.stringify({ type: "friend_count", value: 1 }),
    rarity: "bronze",
    points: 15,
    unlockHint: "Add your first friend"
  },
  {
    name: "Chatterbox",
    description: "Communication hero! Sent your first message.",
    category: "Social",
    requirement: JSON.stringify({ type: "message_sent", value: 1 }),
    rarity: "bronze",
    points: 10,
    unlockHint: "Send your first message"
  },
  {
    name: "Squad Assembled",
    description: "Team builder extraordinaire! Added 10 friends to your network.",
    category: "Social",
    requirement: JSON.stringify({ type: "friend_count", value: 10 }),
    rarity: "silver",
    points: 40,
    unlockHint: "Add 10 friends"
  },
  {
    name: "Mentor",
    description: "Wise guide! Helped someone complete a set via trade.",
    category: "Social",
    requirement: JSON.stringify({ type: "trades_completed", value: 1 }),
    rarity: "gold",
    points: 60,
    unlockHint: "Help someone complete a set through trading"
  },
  {
    name: "Social Butterfly",
    description: "Community champion! Active in 50 conversations.",
    category: "Social",
    requirement: JSON.stringify({ type: "messages_sent", value: 50 }),
    rarity: "gold",
    points: 80,
    unlockHint: "Send 50 messages"
  },

  // Achievement Badges
  {
    name: "7-Day Streak",
    description: "Dedicated hero! Logged in every day for a week.",
    category: "Achievement",
    requirement: JSON.stringify({ type: "login_streak", value: 7 }),
    rarity: "silver",
    points: 30,
    unlockHint: "Log in daily for 7 consecutive days"
  },
  {
    name: "Curator",
    description: "Organization master! Added personal notes to 50 cards.",
    category: "Achievement",
    requirement: JSON.stringify({ type: "cards_with_notes", value: 50 }),
    rarity: "gold",
    points: 65,
    unlockHint: "Add personal notes to 50 cards"
  },
  {
    name: "Historian",
    description: "Knowledge keeper! Documented details for 100 cards.",
    category: "Achievement",
    requirement: JSON.stringify({ type: "cards_with_notes", value: 100 }),
    rarity: "platinum",
    points: 120,
    unlockHint: "Add personal notes to 100 cards"
  },
  {
    name: "Speed Collector",
    description: "Lightning fast! Added 50 cards in a single day.",
    category: "Achievement",
    requirement: JSON.stringify({ type: "cards_added_daily", value: 50 }),
    rarity: "gold",
    points: 90,
    unlockHint: "Add 50 cards in one day"
  },
  {
    name: "Night Owl",
    description: "Dedicated collector! Active between midnight and 6 AM.",
    category: "Achievement",
    requirement: JSON.stringify({ type: "night_activity", value: 1 }),
    rarity: "bronze",
    points: 20,
    unlockHint: "Be active between midnight and 6 AM"
  },

  // Event Badges
  {
    name: "Launch Day Hero",
    description: "Original member! Joined during the launch month.",
    category: "Event",
    requirement: JSON.stringify({ type: "launch_month", value: 1 }),
    rarity: "platinum",
    points: 250,
    unlockHint: "Join during launch month"
  },
  {
    name: "Spidey Fan",
    description: "Web-slinger enthusiast! Participated in Spider-Man Day event.",
    category: "Event", 
    requirement: JSON.stringify({ type: "spiderman_event", value: 1 }),
    rarity: "gold",
    points: 100,
    unlockHint: "Participate in Spider-Man Day event"
  },
  {
    name: "Event Winner",
    description: "Champion collector! Won a trivia or trading challenge.",
    category: "Event",
    requirement: JSON.stringify({ type: "event_win", value: 1 }),
    rarity: "platinum",
    points: 300,
    unlockHint: "Win a trivia or trading challenge"
  },
  {
    name: "Early Bird",
    description: "First to the party! One of the first 100 users.",
    category: "Event",
    requirement: JSON.stringify({ type: "user_number", value: 100 }),
    rarity: "gold",
    points: 150,
    unlockHint: "Be among the first 100 users"
  },
  {
    name: "Beta Tester",
    description: "Feedback hero! Provided valuable feedback during beta.",
    category: "Event",
    requirement: JSON.stringify({ type: "beta_feedback", value: 1 }),
    rarity: "silver",
    points: 75,
    unlockHint: "Provide feedback during beta testing"
  }
];

async function initializeBadges() {
  try {
    console.log("Initializing Marvel-themed badges...");
    
    // Clear existing badges first
    await db.delete(badges);
    
    // Insert new badges
    for (const badge of marvelBadges) {
      await db.insert(badges).values(badge);
      console.log(`✓ Added badge: ${badge.name}`);
    }
    
    console.log(`\n🎉 Successfully initialized ${marvelBadges.length} Marvel-themed badges!`);
    console.log("\nBadge Summary:");
    console.log(`- Collection: ${marvelBadges.filter(b => b.category === 'Collection').length} badges`);
    console.log(`- Social: ${marvelBadges.filter(b => b.category === 'Social').length} badges`);
    console.log(`- Achievement: ${marvelBadges.filter(b => b.category === 'Achievement').length} badges`);
    console.log(`- Event: ${marvelBadges.filter(b => b.category === 'Event').length} badges`);
    
  } catch (error) {
    console.error("Error initializing badges:", error);
  }
}

// Run if called directly
initializeBadges();

export { initializeBadges };