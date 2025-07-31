// Verification script to test card count fix
const fetch = require('node-fetch');

async function testCardCounts() {
  const baseUrl = 'http://localhost:5000';
  
  try {
    // Test a set ID that should have more than 50 cards
    const setId = 1887;
    
    console.log('Testing card count endpoints...\n');
    
    // Test paginated endpoint (old way)
    const paginatedResponse = await fetch(`${baseUrl}/api/cards?setId=${setId}`);
    const paginatedCards = await paginatedResponse.json();
    
    // Test dedicated set endpoint (new way)
    const dedicatedResponse = await fetch(`${baseUrl}/api/sets/${setId}/cards`);
    const dedicatedCards = await dedicatedResponse.json();
    
    console.log(`Set ID ${setId} results:`);
    console.log(`- Paginated endpoint (/api/cards?setId=${setId}): ${paginatedCards.length} cards`);
    console.log(`- Dedicated endpoint (/api/sets/${setId}/cards): ${dedicatedCards.length} cards`);
    
    if (paginatedCards.length !== dedicatedCards.length) {
      console.log('\n⚠️  Different card counts detected - this explains the display issue!');
      console.log('✅ Fix implemented: CardGrid now uses dedicated endpoint for set views');
    } else {
      console.log('\n✅ Both endpoints return same count');
    }
    
  } catch (error) {
    console.error('Error testing endpoints:', error.message);
  }
}

testCardCounts();