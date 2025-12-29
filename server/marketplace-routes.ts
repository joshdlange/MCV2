import type { Express } from "express";
import express from "express";
import { db } from "./db";
import { 
  listings, offers, orders, shipments, reviews, reports, blocks,
  users, userCollections, cards, cardSets,
  insertListingSchema, insertOfferSchema, insertReviewSchema, insertReportSchema, insertBlockSchema
} from "../shared/schema";
import { eq, and, or, desc, asc, sql, ne, isNull, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import Stripe from "stripe";
import { shippoService, PARCEL_PRESETS } from "./shippo-service";

const PLATFORM_FEE_PERCENT = 0.06; // 6%
const STRIPE_FEE_PERCENT = 0.029; // 2.9%
const STRIPE_FEE_FIXED = 0.30; // $0.30

// Initialize Stripe with proper validation
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  console.error('⚠️ STRIPE_SECRET_KEY is not configured - marketplace checkout will fail');
}

// Only create Stripe instance if key is available
let stripe: Stripe | null = null;
if (stripeSecretKey) {
  stripe = new Stripe(stripeSecretKey);
}

// Helper to calculate fees
// Flow: Buyer pays total -> Stripe takes fee from gross -> Platform receives net -> Platform pays seller
// Platform takes 6% of item price only (not shipping) as revenue
// Stripe takes 2.9% + $0.30 from the gross payment
function calculateFees(itemPrice: number, shippingCost: number) {
  const total = itemPrice + shippingCost;
  
  // Platform fee applies ONLY to item price (not shipping)
  const platformFee = parseFloat((itemPrice * PLATFORM_FEE_PERCENT).toFixed(2));
  
  // Stripe fee applies to total payment
  const stripeFee = parseFloat((total * STRIPE_FEE_PERCENT + STRIPE_FEE_FIXED).toFixed(2));
  
  // What platform receives from Stripe (after Stripe deducts their fee)
  const platformReceives = parseFloat((total - stripeFee).toFixed(2));
  
  // Calculate Stripe fee breakdown for transparency
  const itemStripeFee = parseFloat((itemPrice * STRIPE_FEE_PERCENT).toFixed(2));
  const shippingStripeFee = parseFloat((shippingCost * STRIPE_FEE_PERCENT + STRIPE_FEE_FIXED).toFixed(2));
  
  // Seller receives:
  // - Item price minus platform fee minus Stripe fee on item
  // - Shipping cost minus Stripe fee on shipping
  // This ensures seller gets full shipping reimbursement minus only processing
  const sellerFromItem = parseFloat((itemPrice - platformFee - itemStripeFee).toFixed(2));
  const sellerFromShipping = parseFloat((shippingCost - shippingStripeFee).toFixed(2));
  const sellerNet = parseFloat((sellerFromItem + sellerFromShipping).toFixed(2));
  
  return { 
    platformFee, 
    stripeFee, 
    platformReceives, 
    total, 
    sellerNet,
    breakdown: {
      itemStripeFee,
      shippingStripeFee,
      sellerFromItem,
      sellerFromShipping,
    }
  };
}

// Generate order number
function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = nanoid(6).toUpperCase();
  return `MCV-${timestamp}-${random}`;
}

export function registerMarketplaceRoutes(app: Express, authenticateUser: any) {
  
  // ============================================
  // LISTINGS ENDPOINTS
  // ============================================
  
  // Browse marketplace listings
  app.get("/api/marketplace/listings", async (req, res) => {
    try {
      const { 
        setId, year, character, cardNumber, minPrice, maxPrice, 
        graded, status = 'active', page = '1', limit = '20',
        sortBy = 'createdAt', sortOrder = 'desc'
      } = req.query;
      
      const pageNum = parseInt(page as string) || 1;
      const limitNum = Math.min(parseInt(limit as string) || 20, 100);
      const offset = (pageNum - 1) * limitNum;
      
      // Build where conditions
      let conditions = [eq(listings.status, status as string)];
      
      if (setId) {
        conditions.push(eq(cards.setId, parseInt(setId as string)));
      }
      if (minPrice) {
        conditions.push(sql`${listings.price} >= ${parseFloat(minPrice as string)}`);
      }
      if (maxPrice) {
        conditions.push(sql`${listings.price} <= ${parseFloat(maxPrice as string)}`);
      }
      
      // Get listings with joins
      const results = await db
        .select({
          listing: listings,
          seller: {
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            photoURL: users.photoURL,
            sellerRating: users.sellerRating,
            sellerReviewCount: users.sellerReviewCount,
          },
          card: cards,
          cardSet: cardSets,
        })
        .from(listings)
        .innerJoin(users, eq(listings.sellerId, users.id))
        .innerJoin(cards, eq(listings.cardId, cards.id))
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(and(...conditions))
        .orderBy(sortOrder === 'asc' ? asc(listings.createdAt) : desc(listings.createdAt))
        .limit(limitNum)
        .offset(offset);
      
      // Get total count
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(listings)
        .innerJoin(cards, eq(listings.cardId, cards.id))
        .where(and(...conditions));
      
      const total = Number(countResult[0]?.count || 0);
      
      res.json({
        listings: results,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        }
      });
    } catch (error) {
      console.error('Browse listings error:', error);
      res.status(500).json({ message: "Failed to fetch listings" });
    }
  });
  
  // Get single listing details
  app.get("/api/marketplace/listings/:id", async (req, res) => {
    try {
      const listingId = parseInt(req.params.id);
      
      const result = await db
        .select({
          listing: listings,
          seller: {
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            photoURL: users.photoURL,
            sellerRating: users.sellerRating,
            sellerReviewCount: users.sellerReviewCount,
            location: users.location,
          },
          card: cards,
          cardSet: cardSets,
        })
        .from(listings)
        .innerJoin(users, eq(listings.sellerId, users.id))
        .innerJoin(cards, eq(listings.cardId, cards.id))
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(eq(listings.id, listingId))
        .limit(1);
      
      if (!result.length) {
        return res.status(404).json({ message: "Listing not found" });
      }
      
      res.json(result[0]);
    } catch (error) {
      console.error('Get listing error:', error);
      res.status(500).json({ message: "Failed to fetch listing" });
    }
  });
  
  // Create listing from collection item
  app.post("/api/marketplace/listings", authenticateUser, async (req: any, res) => {
    try {
      // Check if user is SUPER_HERO
      if (req.user.plan !== 'SUPER_HERO') {
        return res.status(403).json({ message: "Marketplace requires SUPER HERO subscription" });
      }
      
      // Check if user is suspended
      if (req.user.marketplaceSuspended) {
        return res.status(403).json({ message: "Your marketplace access is suspended" });
      }
      
      const { userCollectionId, price, quantity, allowOffers, description } = req.body;
      
      // Validate required fields
      if (!userCollectionId || !price || !description) {
        return res.status(400).json({ message: "Missing required fields: userCollectionId, price, description" });
      }
      
      // Verify ownership of collection item
      const collectionItem = await db
        .select()
        .from(userCollections)
        .where(and(
          eq(userCollections.id, userCollectionId),
          eq(userCollections.userId, req.user.id)
        ))
        .limit(1);
      
      if (!collectionItem.length) {
        return res.status(403).json({ message: "You don't own this card" });
      }
      
      const collection = collectionItem[0];
      
      // Check if card has an image (stock or custom)
      const card = await db.select().from(cards).where(eq(cards.id, collection.cardId)).limit(1);
      if (!card.length) {
        return res.status(404).json({ message: "Card not found" });
      }
      
      const hasImage = card[0].frontImageUrl || req.body.customImages?.length > 0;
      if (!hasImage) {
        return res.status(400).json({ message: "Card must have at least one image to list" });
      }
      
      // Check quantity
      const listingQty = Math.min(quantity || 1, collection.quantity);
      if (listingQty < 1) {
        return res.status(400).json({ message: "Invalid quantity" });
      }
      
      // Create listing
      const [newListing] = await db.insert(listings).values({
        sellerId: req.user.id,
        userCollectionId: userCollectionId,
        cardId: collection.cardId,
        price: price.toString(),
        quantity: listingQty,
        quantityAvailable: listingQty,
        allowOffers: allowOffers ?? true,
        description: description,
        conditionSnapshot: collection.condition,
        customImages: req.body.customImages || [],
        status: 'active',
        publishedAt: new Date(),
      }).returning();
      
      res.status(201).json(newListing);
    } catch (error) {
      console.error('Create listing error:', error);
      res.status(500).json({ message: "Failed to create listing" });
    }
  });
  
  // Update listing
  app.patch("/api/marketplace/listings/:id", authenticateUser, async (req: any, res) => {
    try {
      const listingId = parseInt(req.params.id);
      
      // Verify ownership
      const existing = await db
        .select()
        .from(listings)
        .where(and(eq(listings.id, listingId), eq(listings.sellerId, req.user.id)))
        .limit(1);
      
      if (!existing.length) {
        return res.status(404).json({ message: "Listing not found or not owned by you" });
      }
      
      const { price, allowOffers, description, status } = req.body;
      
      const updates: any = { updatedAt: new Date() };
      if (price !== undefined) updates.price = price.toString();
      if (allowOffers !== undefined) updates.allowOffers = allowOffers;
      if (description !== undefined) updates.description = description;
      if (status !== undefined && ['active', 'cancelled'].includes(status)) {
        updates.status = status;
      }
      
      const [updated] = await db
        .update(listings)
        .set(updates)
        .where(eq(listings.id, listingId))
        .returning();
      
      res.json(updated);
    } catch (error) {
      console.error('Update listing error:', error);
      res.status(500).json({ message: "Failed to update listing" });
    }
  });
  
  // Delete/cancel listing
  app.delete("/api/marketplace/listings/:id", authenticateUser, async (req: any, res) => {
    try {
      const listingId = parseInt(req.params.id);
      
      // Verify ownership
      const existing = await db
        .select()
        .from(listings)
        .where(and(eq(listings.id, listingId), eq(listings.sellerId, req.user.id)))
        .limit(1);
      
      if (!existing.length) {
        return res.status(404).json({ message: "Listing not found or not owned by you" });
      }
      
      // Soft delete by setting status to cancelled
      await db
        .update(listings)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(listings.id, listingId));
      
      res.json({ message: "Listing cancelled successfully" });
    } catch (error) {
      console.error('Delete listing error:', error);
      res.status(500).json({ message: "Failed to cancel listing" });
    }
  });
  
  // Get my listings (seller view)
  app.get("/api/marketplace/my-listings", authenticateUser, async (req: any, res) => {
    try {
      const results = await db
        .select({
          listing: listings,
          card: cards,
          cardSet: cardSets,
        })
        .from(listings)
        .innerJoin(cards, eq(listings.cardId, cards.id))
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(eq(listings.sellerId, req.user.id))
        .orderBy(desc(listings.createdAt));
      
      res.json(results);
    } catch (error) {
      console.error('Get my listings error:', error);
      res.status(500).json({ message: "Failed to fetch your listings" });
    }
  });
  
  // ============================================
  // OFFERS ENDPOINTS
  // ============================================
  
  // Submit an offer on a listing
  app.post("/api/marketplace/listings/:id/offers", authenticateUser, async (req: any, res) => {
    try {
      if (req.user.plan !== 'SUPER_HERO') {
        return res.status(403).json({ message: "Marketplace requires SUPER HERO subscription" });
      }
      
      const listingId = parseInt(req.params.id);
      const { amount, quantity = 1, message } = req.body;
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Invalid offer amount" });
      }
      
      // Get listing
      const listing = await db
        .select()
        .from(listings)
        .where(and(eq(listings.id, listingId), eq(listings.status, 'active')))
        .limit(1);
      
      if (!listing.length) {
        return res.status(404).json({ message: "Listing not found or not active" });
      }
      
      if (!listing[0].allowOffers) {
        return res.status(400).json({ message: "This listing does not accept offers" });
      }
      
      // Can't offer on your own listing
      if (listing[0].sellerId === req.user.id) {
        return res.status(400).json({ message: "You cannot make an offer on your own listing" });
      }
      
      // Check for existing pending offer
      const existingOffer = await db
        .select()
        .from(offers)
        .where(and(
          eq(offers.listingId, listingId),
          eq(offers.buyerId, req.user.id),
          eq(offers.status, 'pending')
        ))
        .limit(1);
      
      if (existingOffer.length) {
        return res.status(400).json({ message: "You already have a pending offer on this listing" });
      }
      
      // Create offer (expires in 48 hours)
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 48);
      
      const [newOffer] = await db.insert(offers).values({
        listingId,
        buyerId: req.user.id,
        amount: amount.toString(),
        quantity: Math.min(quantity, listing[0].quantityAvailable),
        message,
        status: 'pending',
        expiresAt,
      }).returning();
      
      res.status(201).json(newOffer);
    } catch (error) {
      console.error('Submit offer error:', error);
      res.status(500).json({ message: "Failed to submit offer" });
    }
  });
  
  // Get offers on a listing (seller view)
  app.get("/api/marketplace/listings/:id/offers", authenticateUser, async (req: any, res) => {
    try {
      const listingId = parseInt(req.params.id);
      
      // Verify ownership
      const listing = await db
        .select()
        .from(listings)
        .where(and(eq(listings.id, listingId), eq(listings.sellerId, req.user.id)))
        .limit(1);
      
      if (!listing.length) {
        return res.status(404).json({ message: "Listing not found or not owned by you" });
      }
      
      const offersList = await db
        .select({
          offer: offers,
          buyer: {
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            photoURL: users.photoURL,
          },
        })
        .from(offers)
        .innerJoin(users, eq(offers.buyerId, users.id))
        .where(eq(offers.listingId, listingId))
        .orderBy(desc(offers.createdAt));
      
      res.json(offersList);
    } catch (error) {
      console.error('Get listing offers error:', error);
      res.status(500).json({ message: "Failed to fetch offers" });
    }
  });
  
  // Accept/decline/counter offer
  app.patch("/api/marketplace/offers/:id", authenticateUser, async (req: any, res) => {
    try {
      const offerId = parseInt(req.params.id);
      const { action, counterAmount } = req.body;
      
      if (!['accept', 'decline', 'counter', 'withdraw'].includes(action)) {
        return res.status(400).json({ message: "Invalid action" });
      }
      
      // Get offer with listing
      const offerResult = await db
        .select({
          offer: offers,
          listing: listings,
        })
        .from(offers)
        .innerJoin(listings, eq(offers.listingId, listings.id))
        .where(eq(offers.id, offerId))
        .limit(1);
      
      if (!offerResult.length) {
        return res.status(404).json({ message: "Offer not found" });
      }
      
      const { offer, listing } = offerResult[0];
      
      // Validate permissions
      if (action === 'withdraw') {
        if (offer.buyerId !== req.user.id) {
          return res.status(403).json({ message: "Only the buyer can withdraw an offer" });
        }
      } else {
        if (listing.sellerId !== req.user.id) {
          return res.status(403).json({ message: "Only the seller can accept/decline/counter offers" });
        }
      }
      
      if (offer.status !== 'pending') {
        return res.status(400).json({ message: "Offer is no longer pending" });
      }
      
      let newStatus = offer.status;
      const updates: any = { updatedAt: new Date() };
      
      switch (action) {
        case 'accept':
          newStatus = 'accepted';
          break;
        case 'decline':
          newStatus = 'declined';
          break;
        case 'counter':
          if (!counterAmount || counterAmount <= 0) {
            return res.status(400).json({ message: "Counter amount required" });
          }
          newStatus = 'countered';
          updates.counterAmount = counterAmount.toString();
          break;
        case 'withdraw':
          newStatus = 'withdrawn';
          break;
      }
      
      updates.status = newStatus;
      
      const [updated] = await db
        .update(offers)
        .set(updates)
        .where(eq(offers.id, offerId))
        .returning();
      
      res.json(updated);
    } catch (error) {
      console.error('Update offer error:', error);
      res.status(500).json({ message: "Failed to update offer" });
    }
  });
  
  // Get my offers (buyer view)
  app.get("/api/marketplace/my-offers", authenticateUser, async (req: any, res) => {
    try {
      const offersList = await db
        .select({
          offer: offers,
          listing: listings,
          card: cards,
          cardSet: cardSets,
          seller: {
            id: users.id,
            username: users.username,
            displayName: users.displayName,
          },
        })
        .from(offers)
        .innerJoin(listings, eq(offers.listingId, listings.id))
        .innerJoin(cards, eq(listings.cardId, cards.id))
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .innerJoin(users, eq(listings.sellerId, users.id))
        .where(eq(offers.buyerId, req.user.id))
        .orderBy(desc(offers.createdAt));
      
      res.json(offersList);
    } catch (error) {
      console.error('Get my offers error:', error);
      res.status(500).json({ message: "Failed to fetch your offers" });
    }
  });
  
  // Get offers received (seller view)
  app.get("/api/marketplace/received-offers", authenticateUser, async (req: any, res) => {
    try {
      const offersList = await db
        .select({
          offer: offers,
          listing: listings,
          card: cards,
          buyer: {
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            photoURL: users.photoURL,
          },
        })
        .from(offers)
        .innerJoin(listings, eq(offers.listingId, listings.id))
        .innerJoin(cards, eq(listings.cardId, cards.id))
        .innerJoin(users, eq(offers.buyerId, users.id))
        .where(eq(listings.sellerId, req.user.id))
        .orderBy(desc(offers.createdAt));
      
      res.json(offersList);
    } catch (error) {
      console.error('Get received offers error:', error);
      res.status(500).json({ message: "Failed to fetch received offers" });
    }
  });
  
  // ============================================
  // ORDERS ENDPOINTS
  // ============================================
  
  // Create checkout session (initiate purchase)
  app.post("/api/marketplace/checkout", authenticateUser, async (req: any, res) => {
    try {
      // Check if Stripe is configured
      if (!stripe) {
        console.error('🚨 STRIPE_SECRET_KEY not configured - Stripe instance is null!');
        return res.status(500).json({ message: "Payment system not configured. Please contact support." });
      }
      
      if (req.user.plan !== 'SUPER_HERO') {
        return res.status(403).json({ message: "Marketplace requires SUPER HERO subscription" });
      }
      
      const { listingId, offerId, quantity = 1, shippingAddress, shippingCost } = req.body;
      
      if (!listingId || !shippingAddress || shippingCost === undefined) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      
      // Get listing
      const listing = await db
        .select()
        .from(listings)
        .where(and(eq(listings.id, listingId), eq(listings.status, 'active')))
        .limit(1);
      
      if (!listing.length) {
        return res.status(404).json({ message: "Listing not found or not active" });
      }
      
      const listingData = listing[0];
      
      // Can't buy your own listing
      if (listingData.sellerId === req.user.id) {
        return res.status(400).json({ message: "You cannot purchase your own listing" });
      }
      
      // Determine price (from offer if accepted, otherwise listing price)
      let itemPrice = parseFloat(listingData.price || '0');
      
      if (offerId) {
        const offer = await db.select().from(offers).where(eq(offers.id, offerId)).limit(1);
        if (offer.length && offer[0].status === 'accepted') {
          itemPrice = parseFloat(offer[0].amount || '0');
        }
      }
      
      // Calculate fees
      const fees = calculateFees(itemPrice, shippingCost);
      
      // Get card details for checkout description
      const card = await db
        .select({ card: cards, cardSet: cardSets })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(eq(cards.id, listingData.cardId))
        .limit(1);
      
      const cardName = card.length ? `${card[0].card.name} - ${card[0].cardSet.name}` : 'Marvel Card';
      
      // Create Stripe checkout session
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: cardName,
              description: `Condition: ${listingData.conditionSnapshot}`,
            },
            unit_amount: Math.round(itemPrice * 100), // cents
          },
          quantity: quantity,
        }, {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Shipping',
            },
            unit_amount: Math.round(shippingCost * 100),
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${process.env.REPLIT_DOMAINS?.split(',')[0] ? 'https://' + process.env.REPLIT_DOMAINS.split(',')[0] : 'http://localhost:5000'}/activity?tab=purchases&order=success`,
        cancel_url: `${process.env.REPLIT_DOMAINS?.split(',')[0] ? 'https://' + process.env.REPLIT_DOMAINS.split(',')[0] : 'http://localhost:5000'}/marketplace/${listingId}`,
        metadata: {
          type: 'marketplace_purchase',
          listingId: listingId.toString(),
          buyerId: req.user.id.toString(),
          sellerId: listingData.sellerId.toString(),
          offerId: offerId?.toString() || '',
          quantity: quantity.toString(),
          itemPrice: itemPrice.toString(),
          shippingCost: shippingCost.toString(),
          shippingAddress: JSON.stringify(shippingAddress),
        },
      });
      
      // Create order record
      const orderNumber = generateOrderNumber();
      
      const [order] = await db.insert(orders).values({
        orderNumber,
        listingId,
        offerId: offerId || null,
        buyerId: req.user.id,
        sellerId: listingData.sellerId,
        quantity,
        itemPrice: itemPrice.toString(),
        shippingCost: shippingCost.toString(),
        platformFee: fees.platformFee.toString(),
        stripeFee: fees.stripeFee.toString(),
        total: fees.total.toString(),
        sellerNet: fees.sellerNet.toString(),
        stripeCheckoutSessionId: session.id,
        shippingAddress: JSON.stringify(shippingAddress),
        status: 'payment_pending',
        paymentStatus: 'pending',
      }).returning();
      
      res.json({
        checkoutUrl: session.url,
        orderId: order.id,
        orderNumber: order.orderNumber,
      });
    } catch (error) {
      console.error('Create checkout error:', error);
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });
  
  // Get shipping quote for quick checkout
  app.post("/api/marketplace/shipping/quick-quote", authenticateUser, async (req: any, res) => {
    try {
      if (req.user.plan !== 'SUPER_HERO') {
        return res.status(403).json({ message: "Marketplace requires SUPER HERO subscription" });
      }
      
      const { collectionItemId } = req.body;
      
      if (!collectionItemId) {
        return res.status(400).json({ message: "Collection item ID required" });
      }
      
      // Get buyer's shipping address
      const [buyer] = await db.select({ 
        shippingAddressJson: users.shippingAddressJson 
      })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);
      
      if (!buyer?.shippingAddressJson) {
        return res.status(400).json({ 
          message: "Please set your shipping address in your profile first",
          needsAddress: true 
        });
      }
      
      // Get seller's address and verify item availability
      const [item] = await db
        .select({
          collectionItem: userCollections,
          sellerAddress: users.shippingAddressJson,
          sellerId: users.id,
        })
        .from(userCollections)
        .innerJoin(users, eq(userCollections.userId, users.id))
        .where(and(
          eq(userCollections.id, collectionItemId),
          eq(userCollections.isForSale, true)
        ))
        .limit(1);
      
      if (!item) {
        return res.status(404).json({ message: "Item not available" });
      }
      
      if (!item.sellerAddress) {
        return res.status(400).json({ message: "Seller has not set a shipping address" });
      }
      
      // Can't buy own items
      if (item.sellerId === req.user.id) {
        return res.status(400).json({ message: "You cannot purchase your own items" });
      }
      
      const fromAddr = JSON.parse(item.sellerAddress);
      const toAddr = JSON.parse(buyer.shippingAddressJson);
      
      // Get rates from Shippo using standard toploader parcel
      const { shipmentId, rates } = await shippoService.createShipmentAndGetRates(
        fromAddr,
        toAddr,
        {
          length: 7,
          width: 5,
          height: 0.5,
          weight: 2,
          distance_unit: "in",
          mass_unit: "oz",
        }
      );
      
      if (!rates.length) {
        return res.status(400).json({ message: "No shipping rates available for this destination" });
      }
      
      // Return cheapest USPS rate
      const cheapestRate = rates.reduce((min, rate) => 
        parseFloat(rate.amount) < parseFloat(min.amount) ? rate : min
      );
      
      res.json({
        shippingCost: parseFloat(cheapestRate.amount),
        rateId: cheapestRate.object_id,
        shipmentId,
        carrier: cheapestRate.provider,
        serviceLevel: cheapestRate.servicelevel.name,
        estimatedDays: cheapestRate.estimated_days,
        expiresAt: Date.now() + (15 * 60 * 1000),
      });
    } catch (error: any) {
      console.error('Quick quote error:', error);
      res.status(500).json({ message: "Failed to get shipping quote" });
    }
  });
  
  // Quick checkout from collection item (simplified flow for items marked isForSale)
  app.post("/api/marketplace/quick-checkout", authenticateUser, async (req: any, res) => {
    const { collectionItemId, shippingRateId } = req.body;
    let reservedListingId: number | null = null;
    let reservedCollectionItemId: number | null = null;
    
    console.log('🛒 Quick checkout request:', { collectionItemId, shippingRateId, userId: req.user?.id, userPlan: req.user?.plan });
    
    try {
      // Check if Stripe is configured
      if (!stripe) {
        console.error('🚨 STRIPE_SECRET_KEY not configured - Stripe instance is null!');
        return res.status(500).json({ message: "Payment system not configured. Please contact support." });
      }
      
      if (req.user.plan !== 'SUPER_HERO') {
        return res.status(403).json({ message: "Marketplace requires SUPER HERO subscription" });
      }
      
      if (!collectionItemId) {
        return res.status(400).json({ message: "Collection item ID is required" });
      }
      
      // Require and verify shipping rate ID - no client-provided costs allowed
      if (!shippingRateId) {
        return res.status(400).json({ 
          message: "Shipping quote required. Please get a shipping quote first.",
          needsShippingQuote: true 
        });
      }
      
      const rateVerification = await shippoService.verifyRateAndGetCost(shippingRateId);
      if (!rateVerification.valid) {
        return res.status(400).json({ 
          message: "Invalid or expired shipping rate. Please get a new quote.",
          needsShippingQuote: true 
        });
      }
      
      const verifiedShippingCost = rateVerification.amount;
      console.log('✅ Verified shipping cost from Shippo:', verifiedShippingCost);
      
      // Use transaction with advisory lock for atomic reservation
      const result = await db.transaction(async (tx) => {
        // Acquire advisory lock on the collection item ID to prevent race conditions
        // This blocks other transactions trying to purchase the same item
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${collectionItemId})`);
        
        // Get the collection item with card details (within transaction)
        const collectionResult = await tx
          .select({
            collection: userCollections,
            card: cards,
            cardSet: cardSets,
          })
          .from(userCollections)
          .innerJoin(cards, eq(userCollections.cardId, cards.id))
          .innerJoin(cardSets, eq(cards.setId, cardSets.id))
          .where(and(
            eq(userCollections.id, collectionItemId),
            eq(userCollections.isForSale, true)
          ))
          .limit(1);
        
        if (!collectionResult.length) {
          throw new Error('ITEM_NOT_AVAILABLE');
        }
        
        const { collection: collectionItem, card, cardSet } = collectionResult[0];
        
        // Can't buy your own item
        if (collectionItem.userId === req.user.id) {
          throw new Error('CANNOT_BUY_OWN_ITEM');
        }
        
        // Check if there's already a pending order for this item
        const existingOrder = await tx
          .select()
          .from(orders)
          .innerJoin(listings, eq(orders.listingId, listings.id))
          .where(and(
            eq(listings.userCollectionId, collectionItemId),
            eq(orders.status, 'payment_pending')
          ))
          .limit(1);
        
        if (existingOrder.length) {
          throw new Error('ALREADY_PENDING');
        }
        
        const itemPrice = parseFloat(collectionItem.salePrice || '0');
        if (itemPrice <= 0) {
          throw new Error('NO_VALID_PRICE');
        }
        
        // Use the server-verified shipping cost (already validated before transaction)
        const shippingCost = verifiedShippingCost;
        
        const fees = calculateFees(itemPrice, shippingCost);
        const cardName = `${card.name} - ${cardSet.name}`;
        
        // Immediately mark collection item as not for sale (reservation)
        await tx.update(userCollections).set({
          isForSale: false,
        }).where(eq(userCollections.id, collectionItemId));
        reservedCollectionItemId = collectionItemId;
        
        // Auto-create or find existing listing for this collection item
        let listingRecord = await tx
          .select()
          .from(listings)
          .where(eq(listings.userCollectionId, collectionItemId))
          .limit(1);
        
        let listingId: number;
        
        if (!listingRecord.length) {
          // Create a new listing on-the-fly
          const [newListing] = await tx.insert(listings).values({
            sellerId: collectionItem.userId,
            userCollectionId: collectionItemId,
            cardId: collectionItem.cardId,
            price: itemPrice.toString(),
            quantity: 1,
            quantityAvailable: 0,
            allowOffers: false,
            description: collectionItem.notes || `${card.name} for sale`,
            conditionSnapshot: collectionItem.condition || 'Near Mint',
            status: 'reserved',
            publishedAt: new Date(),
          }).returning();
          listingId = newListing.id;
        } else {
          listingId = listingRecord[0].id;
          await tx.update(listings).set({
            quantityAvailable: 0,
            status: 'reserved',
            updatedAt: new Date(),
          }).where(eq(listings.id, listingId));
        }
        reservedListingId = listingId;
        
        return { collectionItem, card, cardSet, itemPrice, shippingCost, fees, cardName, listingId };
      });
      
      // Transaction succeeded - now create Stripe session (outside transaction)
      const { collectionItem, itemPrice, shippingCost, fees, cardName, listingId } = result;
      
      const baseUrl = process.env.REPLIT_DOMAINS?.split(',')[0] 
        ? 'https://' + process.env.REPLIT_DOMAINS.split(',')[0] 
        : 'http://localhost:5000';
      
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        shipping_address_collection: {
          allowed_countries: ['US', 'CA'],
        },
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: cardName,
              description: `Condition: ${collectionItem.condition || 'Near Mint'}`,
            },
            unit_amount: Math.round(itemPrice * 100),
          },
          quantity: 1,
        }, {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Shipping (Standard)',
            },
            unit_amount: Math.round(shippingCost * 100),
          },
          quantity: 1,
        }],
        mode: 'payment',
        expires_at: Math.floor(Date.now() / 1000) + (30 * 60),
        success_url: `${baseUrl}/activity?tab=purchases&order=success`,
        cancel_url: `${baseUrl}/marketplace?cancelled=true&itemId=${collectionItemId}`,
        metadata: {
          type: 'marketplace_purchase',
          listingId: listingId.toString(),
          collectionItemId: collectionItemId.toString(),
          buyerId: req.user.id.toString(),
          sellerId: collectionItem.userId.toString(),
          itemPrice: itemPrice.toString(),
          shippingCost: shippingCost.toString(),
          shippingRateId: shippingRateId || '',
        },
      });
      
      // Create order record
      const orderNumber = generateOrderNumber();
      
      const [order] = await db.insert(orders).values({
        orderNumber,
        listingId,
        buyerId: req.user.id,
        sellerId: collectionItem.userId,
        quantity: 1,
        itemPrice: itemPrice.toFixed(2),
        shippingCost: shippingCost.toFixed(2),
        platformFee: fees.platformFee.toFixed(2),
        stripeFee: fees.stripeFee.toFixed(2),
        total: fees.total.toFixed(2),
        sellerNet: fees.sellerNet.toFixed(2),
        stripeCheckoutSessionId: session.id,
        status: 'payment_pending',
        paymentStatus: 'pending',
      }).returning();
      
      console.log('✅ Quick checkout success:', { orderId: order.id, orderNumber: order.orderNumber, sessionId: session.id });
      
      res.json({
        url: session.url,
        orderId: order.id,
        orderNumber: order.orderNumber,
      });
    } catch (error: any) {
      console.error('🚨 Quick checkout error:', {
        message: error.message,
        code: error.code,
        type: error.type,
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
        collectionItemId,
        userId: req.user?.id,
        userPlan: req.user?.plan,
      });
      
      // Rollback reservation if Stripe session creation or order insert failed
      if (reservedCollectionItemId) {
        try {
          await db.update(userCollections).set({ isForSale: true })
            .where(eq(userCollections.id, reservedCollectionItemId));
        } catch (rollbackErr) {
          console.error('Rollback collection item failed:', rollbackErr);
        }
      }
      if (reservedListingId) {
        try {
          await db.update(listings).set({ status: 'active', quantityAvailable: 1, updatedAt: new Date() })
            .where(eq(listings.id, reservedListingId));
        } catch (rollbackErr) {
          console.error('Rollback listing failed:', rollbackErr);
        }
      }
      
      // Return specific error messages
      if (error.message === 'ITEM_NOT_AVAILABLE') {
        return res.status(404).json({ message: "Item not found or not for sale" });
      }
      if (error.message === 'CANNOT_BUY_OWN_ITEM') {
        return res.status(400).json({ message: "You cannot purchase your own item" });
      }
      if (error.message === 'ALREADY_PENDING') {
        return res.status(409).json({ message: "This item already has a pending purchase" });
      }
      if (error.message === 'NO_VALID_PRICE') {
        return res.status(400).json({ message: "Item has no valid sale price" });
      }
      
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });
  
  // Release reserved item if checkout is cancelled or expires
  app.post("/api/marketplace/release-reservation", authenticateUser, async (req: any, res) => {
    try {
      const { collectionItemId } = req.body;
      
      if (!collectionItemId) {
        return res.status(400).json({ message: "Collection item ID is required" });
      }
      
      // Find pending orders for this item
      const pendingOrder = await db
        .select({ order: orders, listing: listings })
        .from(orders)
        .innerJoin(listings, eq(orders.listingId, listings.id))
        .where(and(
          eq(listings.userCollectionId, collectionItemId),
          eq(orders.status, 'payment_pending'),
          eq(orders.buyerId, req.user.id)
        ))
        .limit(1);
      
      if (pendingOrder.length) {
        // Cancel the order
        await db.update(orders).set({
          status: 'cancelled',
          paymentStatus: 'cancelled',
          updatedAt: new Date(),
        }).where(eq(orders.id, pendingOrder[0].order.id));
        
        // Re-activate the listing
        await db.update(listings).set({
          status: 'active',
          quantityAvailable: 1,
          updatedAt: new Date(),
        }).where(eq(listings.id, pendingOrder[0].listing.id));
        
        // Re-enable sale on collection item
        await db.update(userCollections).set({
          isForSale: true,
        }).where(eq(userCollections.id, collectionItemId));
      }
      
      res.json({ message: "Reservation released" });
    } catch (error) {
      console.error('Release reservation error:', error);
      res.status(500).json({ message: "Failed to release reservation" });
    }
  });
  
  // Get my purchases (buyer)
  app.get("/api/marketplace/purchases", authenticateUser, async (req: any, res) => {
    try {
      const ordersList = await db
        .select({
          order: orders,
          listing: listings,
          card: cards,
          cardSet: cardSets,
          seller: {
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            photoURL: users.photoURL,
          },
          shipment: shipments,
          review: reviews,
        })
        .from(orders)
        .innerJoin(listings, eq(orders.listingId, listings.id))
        .innerJoin(cards, eq(listings.cardId, cards.id))
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .innerJoin(users, eq(orders.sellerId, users.id))
        .leftJoin(shipments, eq(orders.id, shipments.orderId))
        .leftJoin(reviews, eq(orders.id, reviews.orderId))
        .where(eq(orders.buyerId, req.user.id))
        .orderBy(desc(orders.createdAt));
      
      res.json(ordersList);
    } catch (error) {
      console.error('Get purchases error:', error);
      res.status(500).json({ message: "Failed to fetch purchases" });
    }
  });
  
  // Get my sales (seller)
  app.get("/api/marketplace/sales", authenticateUser, async (req: any, res) => {
    try {
      const ordersList = await db
        .select({
          order: orders,
          listing: listings,
          card: cards,
          cardSet: cardSets,
          buyer: {
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            photoURL: users.photoURL,
          },
          shipment: shipments,
          review: reviews,
        })
        .from(orders)
        .innerJoin(listings, eq(orders.listingId, listings.id))
        .innerJoin(cards, eq(listings.cardId, cards.id))
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .innerJoin(users, eq(orders.buyerId, users.id))
        .leftJoin(shipments, eq(orders.id, shipments.orderId))
        .leftJoin(reviews, eq(orders.id, reviews.orderId))
        .where(eq(orders.sellerId, req.user.id))
        .orderBy(desc(orders.createdAt));
      
      res.json(ordersList);
    } catch (error) {
      console.error('Get sales error:', error);
      res.status(500).json({ message: "Failed to fetch sales" });
    }
  });
  
  // Get order details
  app.get("/api/marketplace/orders/:id", authenticateUser, async (req: any, res) => {
    try {
      const orderId = parseInt(req.params.id);
      
      const result = await db
        .select({
          order: orders,
          listing: listings,
          card: cards,
          cardSet: cardSets,
          buyer: {
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            photoURL: users.photoURL,
          },
          shipment: shipments,
          review: reviews,
        })
        .from(orders)
        .innerJoin(listings, eq(orders.listingId, listings.id))
        .innerJoin(cards, eq(listings.cardId, cards.id))
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .innerJoin(users, eq(orders.buyerId, users.id))
        .leftJoin(shipments, eq(orders.id, shipments.orderId))
        .leftJoin(reviews, eq(orders.id, reviews.orderId))
        .where(eq(orders.id, orderId))
        .limit(1);
      
      if (!result.length) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      const order = result[0];
      
      // Verify access (buyer or seller)
      if (order.order.buyerId !== req.user.id && order.order.sellerId !== req.user.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      res.json(order);
    } catch (error) {
      console.error('Get order error:', error);
      res.status(500).json({ message: "Failed to fetch order" });
    }
  });
  
  // ============================================
  // REVIEWS ENDPOINTS
  // ============================================
  
  // Submit review (buyer only, after delivered)
  app.post("/api/marketplace/orders/:id/review", authenticateUser, async (req: any, res) => {
    try {
      const orderId = parseInt(req.params.id);
      const { rating, comment } = req.body;
      
      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ message: "Rating must be between 1 and 5" });
      }
      
      // Get order
      const order = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      
      if (!order.length) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      if (order[0].buyerId !== req.user.id) {
        return res.status(403).json({ message: "Only the buyer can leave a review" });
      }
      
      if (!['delivered', 'complete'].includes(order[0].status)) {
        return res.status(400).json({ message: "You can only review delivered orders" });
      }
      
      // Check for existing review
      const existingReview = await db.select().from(reviews).where(eq(reviews.orderId, orderId)).limit(1);
      if (existingReview.length) {
        return res.status(400).json({ message: "You have already reviewed this order" });
      }
      
      // Create review
      const [newReview] = await db.insert(reviews).values({
        orderId,
        reviewerId: req.user.id,
        revieweeId: order[0].sellerId,
        rating,
        comment,
      }).returning();
      
      // Update seller rating
      const sellerReviews = await db
        .select({ rating: reviews.rating })
        .from(reviews)
        .where(eq(reviews.revieweeId, order[0].sellerId));
      
      const avgRating = sellerReviews.reduce((sum, r) => sum + r.rating, 0) / sellerReviews.length;
      
      await db.update(users).set({
        sellerRating: avgRating.toFixed(2),
        sellerReviewCount: sellerReviews.length,
      }).where(eq(users.id, order[0].sellerId));
      
      res.status(201).json(newReview);
    } catch (error) {
      console.error('Submit review error:', error);
      res.status(500).json({ message: "Failed to submit review" });
    }
  });
  
  // Get user reviews (for profile)
  app.get("/api/marketplace/users/:id/reviews", async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      
      const reviewsList = await db
        .select({
          review: reviews,
          reviewer: {
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            photoURL: users.photoURL,
          },
        })
        .from(reviews)
        .innerJoin(users, eq(reviews.reviewerId, users.id))
        .where(eq(reviews.revieweeId, userId))
        .orderBy(desc(reviews.createdAt));
      
      res.json(reviewsList);
    } catch (error) {
      console.error('Get user reviews error:', error);
      res.status(500).json({ message: "Failed to fetch reviews" });
    }
  });
  
  // ============================================
  // REPORTS & BLOCKS ENDPOINTS
  // ============================================
  
  // Report user/listing/order
  app.post("/api/marketplace/reports", authenticateUser, async (req: any, res) => {
    try {
      const { targetUserId, listingId, orderId, reason, description } = req.body;
      
      // Rate limit: max 5 reports per user per day
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [recentReportsCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(reports)
        .where(and(
          eq(reports.reporterId, req.user.id),
          sql`${reports.createdAt} >= ${oneDayAgo}`
        ));
      
      const reportCount = Number(recentReportsCount?.count || 0);
      if (reportCount >= 5) {
        return res.status(429).json({ 
          message: "You've reached the daily report limit (5 per day). Please try again tomorrow." 
        });
      }
      
      if (!reason || (!targetUserId && !listingId && !orderId)) {
        return res.status(400).json({ message: "Reason and at least one target required" });
      }
      
      const [newReport] = await db.insert(reports).values({
        reporterId: req.user.id,
        targetUserId,
        listingId,
        orderId,
        reason,
        description,
        status: 'open',
      }).returning();
      
      // Check auto-suspend (3 open reports from unique users in 90 days)
      if (targetUserId) {
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        
        const recentReports = await db
          .select({ reporterId: reports.reporterId })
          .from(reports)
          .where(and(
            eq(reports.targetUserId, targetUserId),
            eq(reports.status, 'open'),
            sql`${reports.createdAt} >= ${ninetyDaysAgo}`
          ));
        
        const uniqueReporters = new Set(recentReports.map(r => r.reporterId));
        
        if (uniqueReporters.size >= 3) {
          await db.update(users).set({
            marketplaceSuspended: true,
            marketplaceSuspendedAt: new Date(),
          }).where(eq(users.id, targetUserId));
        }
      }
      
      res.status(201).json(newReport);
    } catch (error) {
      console.error('Submit report error:', error);
      res.status(500).json({ message: "Failed to submit report" });
    }
  });
  
  // Block user
  app.post("/api/marketplace/blocks", authenticateUser, async (req: any, res) => {
    try {
      const { blockedUserId, reason } = req.body;
      
      if (!blockedUserId) {
        return res.status(400).json({ message: "User to block required" });
      }
      
      if (blockedUserId === req.user.id) {
        return res.status(400).json({ message: "You cannot block yourself" });
      }
      
      // Check if already blocked
      const existing = await db
        .select()
        .from(blocks)
        .where(and(
          eq(blocks.blockerId, req.user.id),
          eq(blocks.blockedUserId, blockedUserId)
        ))
        .limit(1);
      
      if (existing.length) {
        return res.status(400).json({ message: "User already blocked" });
      }
      
      const [newBlock] = await db.insert(blocks).values({
        blockerId: req.user.id,
        blockedUserId,
        reason,
      }).returning();
      
      res.status(201).json(newBlock);
    } catch (error) {
      console.error('Block user error:', error);
      res.status(500).json({ message: "Failed to block user" });
    }
  });
  
  // Unblock user
  app.delete("/api/marketplace/blocks/:userId", authenticateUser, async (req: any, res) => {
    try {
      const blockedUserId = parseInt(req.params.userId);
      
      await db
        .delete(blocks)
        .where(and(
          eq(blocks.blockerId, req.user.id),
          eq(blocks.blockedUserId, blockedUserId)
        ));
      
      res.json({ message: "User unblocked" });
    } catch (error) {
      console.error('Unblock user error:', error);
      res.status(500).json({ message: "Failed to unblock user" });
    }
  });
  
  // Get my blocked users
  app.get("/api/marketplace/blocks", authenticateUser, async (req: any, res) => {
    try {
      const blockedList = await db
        .select({
          block: blocks,
          blockedUser: {
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            photoURL: users.photoURL,
          },
        })
        .from(blocks)
        .innerJoin(users, eq(blocks.blockedUserId, users.id))
        .where(eq(blocks.blockerId, req.user.id));
      
      res.json(blockedList);
    } catch (error) {
      console.error('Get blocked users error:', error);
      res.status(500).json({ message: "Failed to fetch blocked users" });
    }
  });
  
  // ============================================
  // ADMIN ENDPOINTS
  // ============================================
  
  // Admin: Get reports
  app.get("/api/admin/marketplace/reports", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const { status } = req.query;
      
      const reportsList = await db
        .select({
          report: reports,
          reporter: {
            id: users.id,
            username: users.username,
          },
        })
        .from(reports)
        .innerJoin(users, eq(reports.reporterId, users.id))
        .where(status ? eq(reports.status, status as string) : undefined)
        .orderBy(desc(reports.createdAt));
      
      res.json(reportsList);
    } catch (error) {
      console.error('Admin get reports error:', error);
      res.status(500).json({ message: "Failed to fetch reports" });
    }
  });
  
  // Admin: Update report status
  app.patch("/api/admin/marketplace/reports/:id", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const reportId = parseInt(req.params.id);
      const { status, resolution } = req.body;
      
      const updates: any = {};
      if (status) updates.status = status;
      if (resolution) updates.resolution = resolution;
      if (status === 'resolved' || status === 'dismissed') {
        updates.resolvedAt = new Date();
        updates.resolvedBy = req.user.id;
      }
      
      const [updated] = await db
        .update(reports)
        .set(updates)
        .where(eq(reports.id, reportId))
        .returning();
      
      res.json(updated);
    } catch (error) {
      console.error('Admin update report error:', error);
      res.status(500).json({ message: "Failed to update report" });
    }
  });
  
  // Admin: Suspend/unsuspend user
  app.patch("/api/admin/marketplace/users/:id/suspend", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const userId = parseInt(req.params.id);
      const { suspended } = req.body;
      
      await db.update(users).set({
        marketplaceSuspended: suspended,
        marketplaceSuspendedAt: suspended ? new Date() : null,
      }).where(eq(users.id, userId));
      
      res.json({ message: `User ${suspended ? 'suspended' : 'unsuspended'} successfully` });
    } catch (error) {
      console.error('Admin suspend user error:', error);
      res.status(500).json({ message: "Failed to update user suspension" });
    }
  });
  
  // ============================================
  // USER SHIPPING ADDRESS
  // ============================================
  
  // Update shipping address
  app.patch("/api/user/shipping-address", authenticateUser, async (req: any, res) => {
    try {
      const { shippingAddress } = req.body;
      
      await db.update(users).set({
        shippingAddressJson: JSON.stringify(shippingAddress),
      }).where(eq(users.id, req.user.id));
      
      res.json({ message: "Shipping address updated" });
    } catch (error) {
      console.error('Update shipping address error:', error);
      res.status(500).json({ message: "Failed to update shipping address" });
    }
  });
  
  // Get shipping address
  app.get("/api/user/shipping-address", authenticateUser, async (req: any, res) => {
    try {
      const user = await db.select({ shippingAddressJson: users.shippingAddressJson })
        .from(users)
        .where(eq(users.id, req.user.id))
        .limit(1);
      
      const address = user[0]?.shippingAddressJson ? JSON.parse(user[0].shippingAddressJson) : null;
      res.json({ shippingAddress: address });
    } catch (error) {
      console.error('Get shipping address error:', error);
      res.status(500).json({ message: "Failed to fetch shipping address" });
    }
  });
  
  // ============================================
  // SHIPPING ENDPOINTS (Shippo Integration)
  // ============================================
  
  // Get parcel presets
  app.get("/api/marketplace/shipping/presets", authenticateUser, async (req: any, res) => {
    res.json(PARCEL_PRESETS);
  });
  
  // Get shipping rates for an order (seller only)
  app.post("/api/marketplace/orders/:id/shipping/rates", authenticateUser, async (req: any, res) => {
    try {
      const orderId = parseInt(req.params.id);
      const { parcel } = req.body;
      
      // Get order and verify seller
      const order = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order.length) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      if (order[0].sellerId !== req.user.id) {
        return res.status(403).json({ message: "Only the seller can get shipping rates" });
      }
      
      if (!['paid', 'needs_shipping'].includes(order[0].status)) {
        return res.status(400).json({ message: "Order is not ready for shipping" });
      }
      
      // Check if shipment record exists, if not create it
      let shipment = await db.select().from(shipments).where(eq(shipments.orderId, orderId)).limit(1);
      
      if (!shipment.length) {
        // Get seller address
        const seller = await db.select({ shippingAddressJson: users.shippingAddressJson })
          .from(users)
          .where(eq(users.id, req.user.id))
          .limit(1);
        
        if (!seller[0]?.shippingAddressJson) {
          return res.status(400).json({ message: "Please set your shipping address first" });
        }
        
        const fromAddress = JSON.parse(seller[0].shippingAddressJson);
        const toAddress = JSON.parse(order[0].shippingAddress);
        
        await shippoService.createShipmentRecord(orderId, fromAddress, toAddress);
      }
      
      // Get rates from Shippo
      const rates = await shippoService.getShippingRatesForOrder(orderId, parcel);
      
      res.json({ rates });
    } catch (error) {
      console.error('Get shipping rates error:', error);
      res.status(500).json({ message: "Failed to get shipping rates" });
    }
  });
  
  // Purchase shipping label (seller only)
  app.post("/api/marketplace/orders/:id/shipping/purchase", authenticateUser, async (req: any, res) => {
    try {
      const orderId = parseInt(req.params.id);
      const { rateId } = req.body;
      
      if (!rateId) {
        return res.status(400).json({ message: "Rate ID is required" });
      }
      
      // Get order and verify seller
      const order = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order.length) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      if (order[0].sellerId !== req.user.id) {
        return res.status(403).json({ message: "Only the seller can purchase shipping labels" });
      }
      
      // Purchase label
      const result = await shippoService.purchaseLabelForOrder(orderId, rateId);
      
      res.json(result);
    } catch (error) {
      console.error('Purchase shipping label error:', error);
      res.status(500).json({ message: "Failed to purchase shipping label" });
    }
  });
  
  // Get shipment details for an order
  app.get("/api/marketplace/orders/:id/shipment", authenticateUser, async (req: any, res) => {
    try {
      const orderId = parseInt(req.params.id);
      
      // Get order and verify access
      const order = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order.length) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      if (order[0].buyerId !== req.user.id && order[0].sellerId !== req.user.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const shipment = await db.select().from(shipments).where(eq(shipments.orderId, orderId)).limit(1);
      
      res.json(shipment[0] || null);
    } catch (error) {
      console.error('Get shipment error:', error);
      res.status(500).json({ message: "Failed to get shipment details" });
    }
  });
  
  // Shippo webhook (no auth - uses Shippo's verification)
  app.post("/api/shippo-webhook", express.raw({ type: 'application/json' }), async (req, res) => {
    try {
      const signature = req.headers['x-shippo-signature'] as string;
      const payload = req.body.toString();
      
      if (!shippoService.verifyWebhookSignature(payload, signature || '')) {
        console.error('❌ Shippo webhook signature verification failed');
        return res.status(401).json({ message: "Invalid signature" });
      }
      
      const event = JSON.parse(payload);
      console.log('✅ Shippo webhook verified:', event.event);
      await shippoService.handleWebhook(event);
      res.status(200).json({ received: true });
    } catch (error) {
      console.error('Shippo webhook error:', error);
      res.status(400).json({ message: "Webhook processing failed" });
    }
  });
  
  // ============================================
  // MARKETPLACE STRIPE WEBHOOK HANDLER
  // ============================================
  
  // Handle marketplace payment confirmations (called from main Stripe webhook)
  app.post("/api/marketplace/payment-confirmed", async (req, res) => {
    try {
      const { sessionId, paymentIntentId } = req.body;
      
      // Find order by checkout session ID
      const order = await db.select().from(orders)
        .where(eq(orders.stripeCheckoutSessionId, sessionId))
        .limit(1);
      
      if (!order.length) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      // Get the Stripe session to retrieve shipping address
      let shippingAddress = order[0].shippingAddress;
      try {
        if (!stripe) {
          throw new Error('Stripe not configured');
        }
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.shipping_details?.address) {
          const addr = session.shipping_details.address;
          shippingAddress = JSON.stringify({
            name: session.shipping_details.name || '',
            street1: addr.line1 || '',
            street2: addr.line2 || '',
            city: addr.city || '',
            state: addr.state || '',
            zip: addr.postal_code || '',
            country: addr.country || 'US',
          });
        }
      } catch (stripeErr) {
        console.error('Failed to retrieve shipping from Stripe:', stripeErr);
      }
      
      // Update order status and shipping address
      await db.update(orders).set({
        status: 'paid',
        paymentStatus: 'succeeded',
        stripePaymentIntentId: paymentIntentId,
        shippingAddress,
        updatedAt: new Date(),
      }).where(eq(orders.id, order[0].id));
      
      // Mark listing as sold
      const listing = await db.select().from(listings).where(eq(listings.id, order[0].listingId)).limit(1);
      if (listing.length) {
        await db.update(listings).set({
          quantityAvailable: 0,
          status: 'sold',
          updatedAt: new Date(),
        }).where(eq(listings.id, order[0].listingId));
        
        // Keep collection item marked as not for sale (already purchased)
        if (listing[0].userCollectionId) {
          await db.update(userCollections).set({
            isForSale: false,
          }).where(eq(userCollections.id, listing[0].userCollectionId));
        }
      }
      
      res.json({ message: "Order confirmed", orderId: order[0].id });
    } catch (error) {
      console.error('Payment confirmation error:', error);
      res.status(500).json({ message: "Failed to confirm payment" });
    }
  });
  
  console.log('Marketplace routes registered');
}
