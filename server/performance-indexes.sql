-- Performance Optimization Indexes for Marvel Card Vault
-- Run these to optimize queries on 60,000+ card database

-- Critical indexes for image processing queries
CREATE INDEX IF NOT EXISTS idx_cards_front_image_url_null ON cards (id) WHERE front_image_url IS NULL;
CREATE INDEX IF NOT EXISTS idx_cards_set_name_number ON cards (set_id, card_number);
CREATE INDEX IF NOT EXISTS idx_cards_name_search ON cards USING gin(to_tsvector('english', name));

-- User collection performance indexes
CREATE INDEX IF NOT EXISTS idx_user_collections_user_id ON user_collections (user_id);
CREATE INDEX IF NOT EXISTS idx_user_collections_card_id ON user_collections (card_id);
CREATE INDEX IF NOT EXISTS idx_user_collections_acquired_date ON user_collections (acquired_date DESC);
CREATE INDEX IF NOT EXISTS idx_user_collections_is_for_sale ON user_collections (is_for_sale) WHERE is_for_sale = true;

-- Wishlist performance indexes
CREATE INDEX IF NOT EXISTS idx_user_wishlists_user_id ON user_wishlists (user_id);
CREATE INDEX IF NOT EXISTS idx_user_wishlists_card_id ON user_wishlists (card_id);

-- Card sets performance indexes
CREATE INDEX IF NOT EXISTS idx_card_sets_name ON card_sets (name);
CREATE INDEX IF NOT EXISTS idx_card_sets_year ON card_sets (year);

-- Price cache performance indexes
CREATE INDEX IF NOT EXISTS idx_card_price_cache_card_id ON card_price_cache (card_id);
CREATE INDEX IF NOT EXISTS idx_card_price_cache_last_fetched ON card_price_cache (last_fetched);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_cards_set_insert ON cards (set_id, is_insert);
CREATE INDEX IF NOT EXISTS idx_cards_rarity_insert ON cards (rarity, is_insert);
CREATE INDEX IF NOT EXISTS idx_user_collections_user_acquired ON user_collections (user_id, acquired_date DESC);

-- Trending cards optimization
CREATE INDEX IF NOT EXISTS idx_user_collections_card_count ON user_collections (card_id);

-- Text search optimization for card names and descriptions
CREATE INDEX IF NOT EXISTS idx_cards_search_text ON cards USING gin(
  to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(card_number, ''))
);

-- Set name search optimization
CREATE INDEX IF NOT EXISTS idx_card_sets_search_text ON card_sets USING gin(to_tsvector('english', name));