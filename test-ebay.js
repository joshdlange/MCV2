import fetch from 'node-fetch';

async function testEbay() {
  try {
    const response = await fetch(`https://svcs.ebay.com/services/search/FindingService/v1?OPERATION-NAME=findItemsByKeywords&SERVICE-VERSION=1.0.0&SECURITY-APPNAME=${process.env.EBAY_APP_ID_PROD}&RESPONSE-DATA-FORMAT=JSON&keywords=marvel&categoryId=183454&sortOrder=BestMatch&paginationInput.entriesPerPage=1`);
    
    console.log('HTTP Status:', response.status);
    
    const data = await response.json();
    console.log('Error ID:', data.errorMessage?.[0]?.error?.[0]?.errorId?.[0]);
    console.log('Full response:', JSON.stringify(data, null, 2));
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testEbay();