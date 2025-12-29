import { db } from "./db";
import { shipments, orders, users } from "../shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { badgeService } from "./badge-service";
import crypto from 'crypto';

const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY;
const SHIPPO_API_URL = "https://api.goshippo.com";

interface ShippoAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
}

interface ShippoParcel {
  length: number;
  width: number;
  height: number;
  weight: number;
  distance_unit: "in" | "cm";
  mass_unit: "lb" | "oz" | "kg" | "g";
}

interface ShippoRate {
  object_id: string;
  provider: string;
  servicelevel: {
    name: string;
    token: string;
  };
  amount: string;
  currency: string;
  estimated_days: number;
  duration_terms: string;
}

interface ShippoShipment {
  object_id: string;
  rates: ShippoRate[];
  address_from: any;
  address_to: any;
  parcels: any[];
}

interface ShippoTransaction {
  object_id: string;
  status: string;
  tracking_number: string;
  tracking_url_provider: string;
  label_url: string;
  rate: string;
}

async function shippoRequest(endpoint: string, method: string = "GET", body?: any) {
  const response = await fetch(`${SHIPPO_API_URL}${endpoint}`, {
    method,
    headers: {
      "Authorization": `ShippoToken ${SHIPPO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Shippo API error: ${response.status} ${errorText}`);
    throw new Error(`Shippo API error: ${response.status}`);
  }

  return response.json();
}

export const shippoService = {
  verifyWebhookSignature(payload: string, signature: string): boolean {
    const SHIPPO_WEBHOOK_SECRET = process.env.SHIPPO_WEBHOOK_SECRET;
    if (!SHIPPO_WEBHOOK_SECRET) {
      console.warn('⚠️ SHIPPO_WEBHOOK_SECRET not configured - webhook verification disabled');
      return true;
    }
    
    try {
      const expectedSignature = crypto
        .createHmac('sha256', SHIPPO_WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');
      
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      console.error('Webhook signature verification error:', error);
      return false;
    }
  },

  // Verify a rate ID and return its cost
  async verifyRateAndGetCost(rateId: string): Promise<{ amount: number; currency: string; valid: boolean }> {
    try {
      const rate = await shippoRequest(`/rates/${rateId}`);
      if (rate && rate.amount && rate.currency) {
        // Verify currency is USD
        if (rate.currency.toUpperCase() !== 'USD') {
          console.warn(`Rate ${rateId} has non-USD currency: ${rate.currency}`);
          return { amount: 0, currency: rate.currency, valid: false };
        }
        return { amount: parseFloat(rate.amount), currency: rate.currency, valid: true };
      }
      return { amount: 0, currency: '', valid: false };
    } catch (error) {
      console.error('Rate verification failed:', error);
      return { amount: 0, currency: '', valid: false };
    }
  },

  async createShipmentAndGetRates(
    fromAddress: ShippoAddress,
    toAddress: ShippoAddress,
    parcel: ShippoParcel
  ): Promise<{ shipmentId: string; rates: ShippoRate[] }> {
    const shipmentData = {
      address_from: {
        name: fromAddress.name,
        street1: fromAddress.street1,
        street2: fromAddress.street2 || "",
        city: fromAddress.city,
        state: fromAddress.state,
        zip: fromAddress.zip,
        country: fromAddress.country,
        phone: fromAddress.phone || "",
        email: fromAddress.email || "",
      },
      address_to: {
        name: toAddress.name,
        street1: toAddress.street1,
        street2: toAddress.street2 || "",
        city: toAddress.city,
        state: toAddress.state,
        zip: toAddress.zip,
        country: toAddress.country,
        phone: toAddress.phone || "",
        email: toAddress.email || "",
      },
      parcels: [{
        length: parcel.length.toString(),
        width: parcel.width.toString(),
        height: parcel.height.toString(),
        weight: parcel.weight.toString(),
        distance_unit: parcel.distance_unit,
        mass_unit: parcel.mass_unit,
      }],
      async: false,
    };

    const shipment: ShippoShipment = await shippoRequest("/shipments", "POST", shipmentData);
    
    // Filter to USPS rates only for US-only marketplace
    const uspsRates = shipment.rates.filter(
      (rate: ShippoRate) => rate.provider === "USPS"
    );

    return {
      shipmentId: shipment.object_id,
      rates: uspsRates,
    };
  },

  async purchaseLabel(rateId: string): Promise<ShippoTransaction> {
    const transactionData = {
      rate: rateId,
      label_file_type: "PDF",
      async: false,
    };

    const transaction: ShippoTransaction = await shippoRequest("/transactions", "POST", transactionData);
    
    if (transaction.status !== "SUCCESS") {
      throw new Error("Failed to purchase shipping label");
    }

    return transaction;
  },

  async getTrackingStatus(carrier: string, trackingNumber: string): Promise<any> {
    return shippoRequest(`/tracks/${carrier}/${trackingNumber}`);
  },

  async createShipmentRecord(
    orderId: number,
    fromAddress: ShippoAddress,
    toAddress: ShippoAddress
  ) {
    const [shipment] = await db.insert(shipments).values({
      orderId,
      fromAddressSnapshot: JSON.stringify(fromAddress),
      toAddressSnapshot: JSON.stringify(toAddress),
      status: "pending",
    }).returning();

    return shipment;
  },

  async getShippingRatesForOrder(orderId: number, parcel: ShippoParcel) {
    // Get order and addresses
    const order = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order.length) {
      throw new Error("Order not found");
    }

    // Get shipment record
    const shipment = await db.select().from(shipments).where(eq(shipments.orderId, orderId)).limit(1);
    if (!shipment.length) {
      throw new Error("Shipment record not found");
    }

    const fromAddress = JSON.parse(shipment[0].fromAddressSnapshot);
    const toAddress = JSON.parse(shipment[0].toAddressSnapshot);

    const { shipmentId, rates } = await this.createShipmentAndGetRates(fromAddress, toAddress, parcel);

    // Update shipment with Shippo shipment ID and parcel info
    await db.update(shipments).set({
      shippoShipmentId: shipmentId,
      parcelSnapshot: JSON.stringify(parcel),
      status: "rates_fetched",
      updatedAt: new Date(),
    }).where(eq(shipments.orderId, orderId));

    return rates;
  },

  async purchaseLabelForOrder(orderId: number, rateId: string) {
    // Get shipment record
    const shipment = await db.select().from(shipments).where(eq(shipments.orderId, orderId)).limit(1);
    if (!shipment.length) {
      throw new Error("Shipment record not found");
    }

    // Purchase the label
    const transaction = await this.purchaseLabel(rateId);

    // Update shipment with label info
    await db.update(shipments).set({
      shippoRateId: rateId,
      shippoTransactionId: transaction.object_id,
      labelUrl: transaction.label_url,
      trackingNumber: transaction.tracking_number,
      trackingUrl: transaction.tracking_url_provider,
      status: "label_purchased",
      purchasedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(shipments.orderId, orderId));

    // Update order status to shipped (only if in valid state)
    await db.update(orders).set({
      status: "shipped",
      updatedAt: new Date(),
    }).where(and(
      eq(orders.id, orderId),
      inArray(orders.status, ['paid', 'needs_shipping', 'label_created'])
    ));

    return {
      labelUrl: transaction.label_url,
      trackingNumber: transaction.tracking_number,
      trackingUrl: transaction.tracking_url_provider,
    };
  },

  async handleWebhook(event: any) {
    // Handle Shippo tracking webhooks
    if (event.event === "track_updated") {
      const { tracking_number, tracking_status } = event.data;
      
      // Find shipment by tracking number
      const shipment = await db
        .select()
        .from(shipments)
        .where(eq(shipments.trackingNumber, tracking_number))
        .limit(1);
      
      if (shipment.length) {
        let newStatus = shipment[0].status;
        let orderStatus: string | null = null;
        
        switch (tracking_status.status) {
          case "TRANSIT":
            newStatus = "in_transit";
            orderStatus = "in_transit";
            break;
          case "DELIVERED":
            newStatus = "delivered";
            orderStatus = "delivered";
            break;
          case "FAILURE":
          case "RETURNED":
            newStatus = "exception";
            break;
        }
        
        await db.update(shipments).set({
          status: newStatus,
          lastWebhookAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(shipments.id, shipment[0].id));
        
        if (orderStatus) {
          const updates: any = {
            status: orderStatus,
            updatedAt: new Date(),
          };
          if (orderStatus === "delivered") {
            updates.deliveredAt = new Date();
          }
          await db.update(orders).set(updates).where(eq(orders.id, shipment[0].orderId));
          
          // Award First Sale badge to seller when order is delivered
          if (orderStatus === "delivered") {
            const order = await db.select().from(orders).where(eq(orders.id, shipment[0].orderId)).limit(1);
            if (order.length) {
              badgeService.checkBadgesOnMarketplaceSale(order[0].sellerId).catch(err => 
                console.error('Background marketplace sale badge check failed:', err)
              );
            }
          }
        }
      }
    }
  },
};

// Pre-defined parcel presets for trading cards
export const PARCEL_PRESETS = {
  single_card_pwe: {
    name: "Single Card (PWE)",
    length: 6,
    width: 4,
    height: 0.25,
    weight: 1,
    distance_unit: "in" as const,
    mass_unit: "oz" as const,
  },
  toploader_bubble: {
    name: "Toploader in Bubble Mailer",
    length: 7,
    width: 5,
    height: 0.5,
    weight: 2,
    distance_unit: "in" as const,
    mass_unit: "oz" as const,
  },
  small_box: {
    name: "Small Box (Multiple Cards)",
    length: 8,
    width: 6,
    height: 2,
    weight: 8,
    distance_unit: "in" as const,
    mass_unit: "oz" as const,
  },
  medium_box: {
    name: "Medium Box (Lot)",
    length: 10,
    width: 8,
    height: 4,
    weight: 16,
    distance_unit: "in" as const,
    mass_unit: "oz" as const,
  },
};
