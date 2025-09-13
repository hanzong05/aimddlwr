// Check training data count for user
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkTrainingData() {
  const userId = '040427c4-c759-47b6-935c-a5be720531ce';
  
  console.log('🔍 Checking training data for user:', userId);
  
  try {
    const { data, error } = await supabase
      .from('training_data')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      console.error('Error fetching training data:', error);
      return;
    }

    console.log(`📊 Total training examples: ${data?.length || 0}`);
    
    if (data && data.length > 0) {
      console.log('\n📚 Training data breakdown:');
      const categoryCounts = {};
      const qualityScores = [];
      
      data.forEach(item => {
        categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
        qualityScores.push(item.quality_score);
      });
      
      Object.entries(categoryCounts).forEach(([category, count]) => {
        console.log(`  - ${category}: ${count} examples`);
      });
      
      const avgQuality = qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length;
      console.log(`\n📈 Average quality score: ${avgQuality.toFixed(2)}`);
      console.log(`📈 Quality score range: ${Math.min(...qualityScores)} - ${Math.max(...qualityScores)}`);
      
      const highQuality = data.filter(item => item.quality_score >= 2.0).length;
      console.log(`📈 High quality examples (≥2.0): ${highQuality}`);
      
      if (data.length >= 10) {
        console.log('✅ Sufficient data for advanced training!');
      } else {
        console.log(`⚠️  Need ${10 - data.length} more examples for advanced training`);
      }
    } else {
      console.log('❌ No training data found');
    }
    
  } catch (error) {
    console.error('Check failed:', error);
  }
}

checkTrainingData().then(() => {
  console.log('\n🔍 Training data check complete!');
  process.exit(0);
}).catch(error => {
  console.error('Check failed:', error);
  process.exit(1);
});