import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { mainSets, cardSets } from "./shared/schema";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);
const db = drizzle(client);

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

async function populateSlugs() {
  console.log('Starting slug population...');
  
  try {
    // First, add slug columns without NOT NULL constraint
    await client`ALTER TABLE main_sets ADD COLUMN IF NOT EXISTS slug TEXT`;
    await client`ALTER TABLE card_sets ADD COLUMN IF NOT EXISTS slug TEXT`;
    
    // Get all main sets and populate slugs
    const allMainSets = await db.select().from(mainSets);
    console.log(`Found ${allMainSets.length} main sets to process`);
    
    for (const mainSet of allMainSets) {
      const baseSlug = generateSlug(mainSet.name);
      let slug = baseSlug;
      let counter = 1;
      
      // Ensure unique slug
      while (true) {
        const existing = await client`SELECT id FROM main_sets WHERE slug = ${slug} AND id != ${mainSet.id}`;
        if (existing.length === 0) break;
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      
      await client`UPDATE main_sets SET slug = ${slug} WHERE id = ${mainSet.id}`;
      console.log(`Updated main set "${mainSet.name}" with slug: ${slug}`);
    }
    
    // Get all card sets and populate slugs
    const allCardSets = await db.select().from(cardSets);
    console.log(`Found ${allCardSets.length} card sets to process`);
    
    for (const cardSet of allCardSets) {
      const baseSlug = generateSlug(cardSet.name);
      let slug = baseSlug;
      let counter = 1;
      
      // Ensure unique slug
      while (true) {
        const existing = await client`SELECT id FROM card_sets WHERE slug = ${slug} AND id != ${cardSet.id}`;
        if (existing.length === 0) break;
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      
      await client`UPDATE card_sets SET slug = ${slug} WHERE id = ${cardSet.id}`;
      console.log(`Updated card set "${cardSet.name}" with slug: ${slug}`);
    }
    
    // Now add NOT NULL and UNIQUE constraints
    console.log('Adding constraints...');
    await client`ALTER TABLE main_sets ALTER COLUMN slug SET NOT NULL`;
    await client`ALTER TABLE main_sets ADD CONSTRAINT main_sets_slug_unique UNIQUE (slug)`;
    
    await client`ALTER TABLE card_sets ALTER COLUMN slug SET NOT NULL`;
    await client`ALTER TABLE card_sets ADD CONSTRAINT card_sets_slug_unique UNIQUE (slug)`;
    
    console.log('Slug population completed successfully!');
  } catch (error) {
    console.error('Error populating slugs:', error);
  } finally {
    await client.end();
  }
}

populateSlugs();