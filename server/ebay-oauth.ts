import { Buffer } from 'buffer';

interface OAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

class EbayOAuthService {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.clientId = process.env.EBAY_CLIENT_ID!;
    this.clientSecret = process.env.EBAY_CLIENT_SECRET!;
    
    if (!this.clientId || !this.clientSecret) {
      throw new Error('EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are required');
    }
  }

  /**
   * Generate OAuth token using client credentials flow
   */
  async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    console.log('Generating new eBay OAuth token...');
    
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    
    const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope/buy.item.feed'
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('eBay OAuth Error:', errorText);
      throw new Error(`OAuth failed: ${response.status} ${response.statusText}`);
    }

    const data: OAuthResponse = await response.json();
    
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 minute early
    
    console.log(`eBay OAuth token generated successfully, expires in ${data.expires_in} seconds`);
    
    return this.accessToken;
  }

  /**
   * Reset token to force refresh
   */
  resetToken(): void {
    this.accessToken = null;
    this.tokenExpiry = 0;
  }
}

export const ebayOAuthService = new EbayOAuthService();