import React, { useState, useEffect, useRef } from 'react';
import { Brain, TrendingUp, MessageSquare, ThumbsUp, ThumbsDown, BarChart3, Lightbulb, Target, BookOpen } from 'lucide-react';

const EnhancedLearningChat = ({ token, isAuthenticated }) => {
  // Chat State
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Learning State
  const [learningStats, setLearningStats] = useState({
    totalPatterns: 0,
    highConfidencePatterns: 0,
    averageConfidence: 0,
    learningRate: 0,
    recentActivity: false
  });
  const [recentPatterns, setRecentPatterns] = useState([]);
  const [showLearningPanel, setShowLearningPanel] = useState(false);
  const [lastResponseData, setLastResponseData] = useState(null);
  const [learningProgress, setLearningProgress] = useState(0);
  
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch learning data when authenticated
  useEffect(() => {
    if (isAuthenticated && token) {
      fetchLearningData();
      // Auto-refresh learning data every 30 seconds
      const interval = setInterval(fetchLearningData, 30000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, token]);

  const fetchLearningData = async () => {
    try {
      // Fetch learning analytics
      const analyticsResponse = await fetch('/api/proxy/learning/analytics', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (analyticsResponse.ok) {
        const analytics = await analyticsResponse.json();
        setLearningStats(analytics);
        setLearningProgress(analytics.learningRate * 100);
      }

      // Fetch recent patterns
      const patternsResponse = await fetch('/api/proxy/learning/patterns?limit=5', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (patternsResponse.ok) {
        const patterns = await patternsResponse.json();
        setRecentPatterns(patterns);
      }
    } catch (error) {
      console.error('Failed to fetch learning data:', error);
    }
  };

  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = { 
      type: 'user', 
      content: input, 
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/proxy/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          message: currentInput, 
          conversationId 
        })
      });

      if (response.ok) {
        const data = await response.json();
        
        const assistantMessage = { 
          type: 'assistant', 
          content: data.response,
          confidence: data.confidence,
          learned: data.learned,
          source: data.source,
          timestamp: new Date(),
          messageId: data.messageId || Date.now()
        };
        
        setMessages(prev => [...prev, assistantMessage]);
        setLastResponseData(data);
        
        if (!conversationId) setConversationId(data.conversationId);
        
        // Refresh learning stats if AI learned something
        if (data.learned || data.confidence) {
          setTimeout(fetchLearningData, 1000);
        }
      } else {
        throw new Error('Failed to get response');
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage = { 
        type: 'assistant', 
        content: 'I encountered an error. Please try again.',
        error: true,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const provideFeedback = async (messageIndex, feedbackType, score = null) => {
    const message = messages[messageIndex];
    if (!message?.messageId) return;

    try {
      await fetch('/api/proxy/learning/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          pattern_id: message.messageId,
          feedback_type: feedbackType,
          feedback_score: score,
          original_response: message.content
        })
      });

      // Update message to show feedback was given
      setMessages(prev => prev.map((msg, idx) => 
        idx === messageIndex 
          ? { ...msg, feedbackGiven: feedbackType, feedbackScore: score }
          : msg
      ));

      // Refresh learning stats
      setTimeout(fetchLearningData, 500);
      
    } catch (error) {
      console.error('Feedback error:', error);
    }
  };

  const getConfidenceIndicator = (confidence) => {
    if (!confidence) return null;
    
    const percentage = Math.round(confidence * 100);
    let colorClass = 'text-gray-500 bg-gray-100';
    let label = 'Learning';
    
    if (confidence >= 0.8) {
      colorClass = 'text-green-700 bg-green-100';
      label = 'Expert';
    } else if (confidence >= 0.6) {
      colorClass = 'text-blue-700 bg-blue-100';
      label = 'Good';
    } else if (confidence >= 0.4) {
      colorClass = 'text-yellow-700 bg-yellow-100';
      label = 'Fair';
    }

    return (
      <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${colorClass}`}>
        <Brain className="w-3 h-3 mr-1" />
        {label} ({percentage}%)
      </div>
    );
  };

  const getLearningBadge = (learned, source) => {
    if (learned) {
      return (
        <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
          <TrendingUp className="w-3 h-3 mr-1" />
          New Learning
        </div>
      );
    } else if (source === 'learned_pattern') {
      return (
        <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
          <BookOpen className="w-3 h-3 mr-1" />
          From Memory
        </div>
      );
    } else if (source === 'external_ai') {
      return (
        <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          <Brain className="w-3 h-3 mr-1" />
          External AI
        </div>
      );
    }
    return null;
  };

  const getLearningLevel = () => {
    const { totalPatterns, averageConfidence } = learningStats;
    
    if (totalPatterns >= 50 && averageConfidence >= 0.7) {
      return { level: 'AI Expert', color: 'text-purple-600', bg: 'bg-purple-100', icon: '🎓' };
    } else if (totalPatterns >= 20 && averageConfidence >= 0.5) {
      return { level: 'Learning Well', color: 'text-blue-600', bg: 'bg-blue-100', icon: '📚' };
    } else if (totalPatterns >= 5) {
      return { level: 'Getting Started', color: 'text-green-600', bg: 'bg-green-100', icon: '🌱' };
    }
    return { level: 'Just Beginning', color: 'text-gray-600', bg: 'bg-gray-100', icon: '🤖' };
  };

  const clearChat = () => {
    setMessages([]);
    setConversationId('');
    setLastResponseData(null);
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg">
        <div className="text-center">
          <Brain className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">AI Learning Chat</h3>
          <p className="text-gray-600">Please sign in to start your learning journey</p>
        </div>
      </div>
    );
  }

  const learningLevel = getLearningLevel();

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Enhanced Header with Learning Indicators */}
        <div className="bg-white shadow-sm border-b p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Brain className="w-8 h-8 text-blue-600" />
                <div>
                  <h1 className="text-xl font-bold text-gray-900">Learning AI Chat</h1>
                  <div className="flex items-center space-x-2 text-sm">
                    <span className={`px-2 py-1 rounded-full ${learningLevel.bg} ${learningLevel.color} font-medium`}>
                      {learningLevel.icon} {learningLevel.level}
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Live Learning Stats */}
              <div className="flex items-center space-x-4 text-sm bg-gray-50 rounded-lg px-3 py-2">
                <div className="flex items-center space-x-1 text-blue-600">
                  <BookOpen className="w-4 h-4" />
                  <span className="font-medium">{learningStats.totalPatterns}</span>
                  <span className="text-gray-500">patterns</span>
                </div>
                <div className="flex items-center space-x-1 text-green-600">
                  <Target className="w-4 h-4" />
                  <span className="font-medium">{Math.round(learningStats.averageConfidence * 100)}%</span>
                  <span className="text-gray-500">confidence</span>
                </div>
                {learningStats.recentActivity && (
                  <div className="flex items-center space-x-1 text-emerald-600">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="text-xs font-medium">Learning</span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowLearningPanel(!showLearningPanel)}
                className={`p-2 rounded-lg transition-colors ${
                  showLearningPanel 
                    ? 'bg-blue-100 text-blue-600' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                title="Toggle learning panel"
              >
                <BarChart3 className="w-5 h-5" />
              </button>
              <button
                onClick={clearChat}
                className="px-3 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Clear Chat
              </button>
            </div>
          </div>

          {/* Learning Progress Bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
              <span>Learning Progress</span>
              <span>{Math.round(learningProgress)}% mastery</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-blue-500 to-emerald-500 h-2 rounded-full transition-all duration-1000"
                style={{ width: `${Math.min(learningProgress, 100)}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <Brain className="w-10 h-10 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">Start Your Learning Journey</h3>
              <p className="text-gray-600 mb-6 max-w-md mx-auto">
                Your AI will learn and adapt from every conversation, becoming smarter and more helpful over time.
              </p>
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-6 max-w-lg mx-auto">
                <div className="flex items-start space-x-3">
                  <Lightbulb className="w-6 h-6 text-yellow-500 mt-1" />
                  <div className="text-left">
                    <h4 className="font-medium text-gray-900 mb-2">How Learning Works:</h4>
                    <ul className="text-sm text-gray-700 space-y-1">
                      <li>• Each conversation creates learning patterns</li>
                      <li>• AI confidence improves with your feedback</li>
                      <li>• Similar questions get better responses over time</li>
                      <li>• Your unique communication style is learned</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-2xl ${msg.type === 'user' ? 'order-2' : 'order-1'}`}>
                  {/* Message Bubble */}
                  <div className={`px-6 py-4 rounded-2xl ${
                    msg.type === 'user' 
                      ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white' 
                      : msg.error
                      ? 'bg-red-50 text-red-800 border border-red-200'
                      : 'bg-white text-gray-800 shadow-sm border border-gray-200'
                  }`}>
                    <p className="leading-relaxed">{msg.content}</p>
                  </div>
                  
                  {/* AI Message Metadata */}
                  {msg.type === 'assistant' && !msg.error && (
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        {getConfidenceIndicator(msg.confidence)}
                        {getLearningBadge(msg.learned, msg.source)}
                      </div>
                      
                      {/* Feedback Controls */}
                      {!msg.feedbackGiven ? (
                        <div className="flex items-center space-x-2">
                          <span className="text-xs text-gray-500 mr-2">Helpful?</span>
                          <button
                            onClick={() => provideFeedback(i, 'positive', 5)}
                            className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="This response was helpful"
                          >
                            <ThumbsUp className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => provideFeedback(i, 'negative', 1)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="This response needs improvement"
                          >
                            <ThumbsDown className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-2 text-xs">
                          <span className={`px-2 py-1 rounded-full ${
                            msg.feedbackGiven === 'positive' 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-red-100 text-red-800'
                          }`}>
                            Feedback: {msg.feedbackGiven}
                          </span>
                          <span className="text-gray-500">Thank you!</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          
          {/* Loading Indicator */}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white rounded-2xl px-6 py-4 shadow-sm border border-gray-200">
                <div className="flex items-center space-x-2">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                  <span className="text-sm text-gray-500 ml-2">AI is thinking and learning...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Enhanced Input Area */}
        <div className="bg-white border-t border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                placeholder={`Ask me anything... I'm learning from our conversation! (${learningStats.totalPatterns} patterns learned)`}
                className="w-full px-6 py-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg placeholder-gray-400"
                disabled={loading}
              />
              {learningStats.totalPatterns > 0 && (
                <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                  <Brain className="w-5 h-5 text-blue-500" />
                </div>
              )}
            </div>
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 transition-all transform hover:scale-105"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <MessageSquare className="w-5 h-5" />
                  <span className="font-medium">Send</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Learning Analytics Panel */}
      {showLearningPanel && (
        <div className="w-96 bg-white border-l border-gray-200 shadow-lg">
          <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-purple-50">
            <h2 className="text-lg font-bold text-gray-900 flex items-center">
              <BarChart3 className="w-6 h-6 mr-3 text-blue-600" />
              Learning Analytics
            </h2>
            <p className="text-sm text-gray-600 mt-1">Real-time AI learning progress</p>
          </div>
          
          <div className="p-6 space-y-6 max-h-screen overflow-y-auto">
            {/* Key Metrics */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-blue-600">{learningStats.totalPatterns}</div>
                <div className="text-sm text-blue-800 font-medium">Total Patterns</div>
              </div>
              <div className="bg-green-50 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-green-600">
                  {Math.round(learningStats.averageConfidence * 100)}%
                </div>
                <div className="text-sm text-green-800 font-medium">Avg Confidence</div>
              </div>
              <div className="bg-purple-50 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-purple-600">{learningStats.highConfidencePatterns}</div>
                <div className="text-sm text-purple-800 font-medium">High Quality</div>
              </div>
              <div className="bg-orange-50 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-orange-600">
                  {Math.round(learningStats.learningRate * 100)}%
                </div>
                <div className="text-sm text-orange-800 font-medium">Mastery Rate</div>
              </div>
            </div>

            {/* Recent Learning Activity */}
            <div>
              <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center">
                <TrendingUp className="w-4 h-4 mr-2" />
                Recent Learning
              </h3>
              {recentPatterns.length > 0 ? (
                <div className="space-y-3">
                  {recentPatterns.slice(0, 3).map((pattern, index) => (
                    <div key={index} className="border-l-4 border-blue-500 pl-4 py-2 bg-gray-50 rounded-r-lg">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          "{pattern.input_pattern?.substring(0, 30)}..."
                        </p>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          pattern.confidence >= 0.7 
                            ? 'bg-green-100 text-green-800' 
                            : pattern.confidence >= 0.5
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {Math.round(pattern.confidence * 100)}%
                        </span>
                      </div>
                      <div className="flex items-center space-x-3 text-xs text-gray-500">
                        <span>Used {pattern.use_count} times</span>
                        {pattern.category && <span>• {pattern.category}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-gray-500">
                  <Brain className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No patterns learned yet</p>
                  <p className="text-xs">Start chatting to see learning progress!</p>
                </div>
              )}
            </div>

            {/* Learning Tips */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4">
              <h3 className="text-sm font-bold text-blue-900 mb-3 flex items-center">
                <Lightbulb className="w-4 h-4 mr-2" />
                Pro Learning Tips
              </h3>
              <ul className="space-y-2 text-sm text-blue-800">
                <li className="flex items-start">
                  <span className="w-2 h-2 bg-blue-500 rounded-full mt-2 mr-2 flex-shrink-0"></span>
                  Ask similar questions to reinforce learning patterns
                </li>
                <li className="flex items-start">
                  <span className="w-2 h-2 bg-blue-500 rounded-full mt-2 mr-2 flex-shrink-0"></span>
                  Use 👍/👎 feedback to improve response quality
                </li>
                <li className="flex items-start">
                  <span className="w-2 h-2 bg-blue-500 rounded-full mt-2 mr-2 flex-shrink-0"></span>
                  Chat regularly to build stronger AI knowledge
                </li>
                <li className="flex items-start">
                  <span className="w-2 h-2 bg-blue-500 rounded-full mt-2 mr-2 flex-shrink-0"></span>
                  Be specific in questions for better learning
                </li>
              </ul>
            </div>

            {/* Learning Status */}
            <div className="text-center">
              <div className={`inline-flex items-center px-4 py-2 rounded-full ${learningLevel.bg} ${learningLevel.color} font-medium`}>
                <span className="mr-2">{learningLevel.icon}</span>
                {learningLevel.level}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {learningStats.totalPatterns < 10 && "Keep chatting to reach the next level!"}
                {learningStats.totalPatterns >= 10 && learningStats.totalPatterns < 25 && "Great progress! You're building a smart AI."}
                {learningStats.totalPatterns >= 25 && "Excellent! Your AI is becoming quite intelligent."}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnhancedLearningChat;