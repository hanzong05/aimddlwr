async function generateAIResponse(userId, message) {
  // Check if user has an active trained model
  const { data: activeModel } = await supabase
    .from('models')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('status', 'deployed')
    .single();

  if (activeModel) {
    // Use trained model - simulate enhanced responses based on training
    return await generateTrainedResponse(activeModel, message);
  } else {
    // Use default AI responses
    return await generateDefaultResponse(message);
  }
}

async function generateTrainedResponse(model, message) {
  // Get some training examples for context
  const { data: examples } = await supabase
    .from('training_data')
    .select('input, output')
    .eq('user_id', model.user_id)
    .eq('used_in_training', true)
    .limit(5);

  // Simple similarity matching (in production, use vector embeddings)
  const lowerMessage = message.toLowerCase();
  const bestMatch = examples?.find(ex => 
    ex.input.toLowerCase().includes(lowerMessage.substring(0, 20)) ||
    lowerMessage.includes(ex.input.toLowerCase().substring(0, 20))
  );

  if (bestMatch) {
    // Return a variation of the trained response
    return `Based on my training: ${bestMatch.output}`;
  }

  // Enhanced default response indicating it's from trained model
  const enhancedResponses = [
    `Using my custom training, I'd say: ${await generateDefaultResponse(message)}`,
    `From my personalized knowledge: ${await generateDefaultResponse(message)}`,
    `Based on our previous conversations: ${await generateDefaultResponse(message)}`
  ];

  return enhancedResponses[Math.floor(Math.random() * enhancedResponses.length)];
}

async function generateDefaultResponse(message) {
  const responses = [
    "That's an interesting question! Let me think about that.",
    "I understand what you're asking. Here's my perspective:",
    "Great point! Let me help you with that.",
    "I can definitely assist you with this."
  ];

  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
    return "Hello! How can I help you today?";
  }
  
  if (lowerMessage.includes('code') || lowerMessage.includes('programming')) {
    return "I'd be happy to help with coding! What programming challenge are you working on?";
  }
  
  return responses[Math.floor(Math.random() * responses.length)];
}