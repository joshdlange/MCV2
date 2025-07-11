-- Initialize database schema for Marvel Card Vault
CREATE TABLE IF NOT EXISTS main_sets (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS card_sets (
  id SERIAL PRIMARY KEY,
  main_set_id INTEGER REFERENCES main_sets(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  year INTEGER,
  total_cards INTEGER DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cards (
  id SERIAL PRIMARY KEY,
  set_id INTEGER REFERENCES card_sets(id) ON DELETE CASCADE,
  card_number VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  variation VARCHAR(255),
  is_insert BOOLEAN DEFAULT false,
  front_image_url TEXT,
  back_image_url TEXT,
  description TEXT,
  rarity VARCHAR(50),
  estimated_value DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  firebase_uid VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  is_admin BOOLEAN DEFAULT false,
  plan VARCHAR(50) DEFAULT 'SIDE_KICK',
  subscription_status VARCHAR(50) DEFAULT 'inactive',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_collections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
  condition VARCHAR(50) DEFAULT 'Near Mint',
  quantity INTEGER DEFAULT 1,
  personal_value DECIMAL(10,2),
  sale_price DECIMAL(10,2),
  is_for_sale BOOLEAN DEFAULT false,
  serial_number VARCHAR(100),
  is_favorite BOOLEAN DEFAULT false,
  notes TEXT,
  acquired_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, card_id)
);

CREATE TABLE IF NOT EXISTS user_wishlists (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
  priority INTEGER DEFAULT 1,
  max_price DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, card_id)
);

CREATE TABLE IF NOT EXISTS card_price_cache (
  id SERIAL PRIMARY KEY,
  card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
  avg_price DECIMAL(10,2),
  min_price DECIMAL(10,2),
  max_price DECIMAL(10,2),
  sales_count INTEGER DEFAULT 0,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(50) DEFAULT 'ebay',
  UNIQUE(card_id, source)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_cards_set_id ON cards(set_id);
CREATE INDEX IF NOT EXISTS idx_card_sets_main_set_id ON card_sets(main_set_id);
CREATE INDEX IF NOT EXISTS idx_user_collections_user_id ON user_collections(user_id);
CREATE INDEX IF NOT EXISTS idx_user_collections_card_id ON user_collections(card_id);
CREATE INDEX IF NOT EXISTS idx_user_wishlists_user_id ON user_wishlists(user_id);
CREATE INDEX IF NOT EXISTS idx_card_price_cache_card_id ON card_price_cache(card_id);

-- Insert sample data for testing trending cards and recent additions
INSERT INTO main_sets (name, slug, description) VALUES 
('Spider-Man Universe', 'spider-man-universe', 'Complete Spider-Man trading card collection'),
('X-Men Collection', 'x-men-collection', 'Mutant heroes and villains'),
('Avengers Assemble', 'avengers-assemble', 'Earth''s Mightiest Heroes')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO card_sets (main_set_id, name, slug, year, total_cards) VALUES 
(1, 'Amazing Spider-Man 1990', 'amazing-spider-man-1990', 1990, 150),
(1, 'Spider-Man Origins', 'spider-man-origins', 1992, 100),
(2, 'Uncanny X-Men 1991', 'uncanny-x-men-1991', 1991, 200),
(3, 'Avengers Classic', 'avengers-classic', 1993, 180)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO cards (set_id, card_number, name, variation, is_insert, rarity, estimated_value) VALUES 
(1, '001', 'Spider-Man Origin', NULL, false, 'Common', 2.50),
(1, '002', 'Green Goblin', NULL, false, 'Rare', 8.50),
(1, '003', 'Spider-Man Hologram', 'Foil Variant', true, 'Insert', 25.00),
(2, '001', 'Peter Parker', NULL, false, 'Common', 3.00),
(2, '002', 'Uncle Ben', NULL, false, 'Uncommon', 5.00),
(3, '001', 'Wolverine', NULL, false, 'Rare', 12.50),
(3, '002', 'Storm', NULL, false, 'Uncommon', 6.50),
(4, '001', 'Iron Man', NULL, false, 'Rare', 10.00),
(4, '002', 'Captain America', NULL, false, 'Rare', 15.00),
(4, '003', 'Thor', NULL, false, 'Rare', 11.50)
ON CONFLICT DO NOTHING;