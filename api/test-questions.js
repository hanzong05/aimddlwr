// api/test-questions.js - Test endpoint for question generation (no auth required)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { count = 3, category = 'programming' } = req.query;

    const sampleQuestions = {
      programming: [
        {
          question: "What is the difference between let and var in JavaScript?",
          answer: "The main differences are scope, hoisting behavior, and redeclaration rules. let is block-scoped while var is function-scoped.",
          category: "javascript",
          difficulty: "beginner"
        },
        {
          question: "How do you handle promises in JavaScript?",
          answer: "You can handle promises using .then()/.catch() or async/await syntax for cleaner code.",
          category: "javascript",
          difficulty: "intermediate"
        },
        {
          question: "What is a React component?",
          answer: "A React component is a reusable piece of UI that can be either a function or class that returns JSX.",
          category: "react",
          difficulty: "beginner"
        }
      ],
      webdev: [
        {
          question: "What is responsive web design?",
          answer: "Responsive web design ensures websites work well on all devices by using flexible layouts, images, and CSS media queries.",
          category: "css",
          difficulty: "beginner"
        }
      ]
    };

    const questions = sampleQuestions[category] || sampleQuestions.programming;
    const selectedQuestions = questions.slice(0, parseInt(count));

    res.json({
      success: true,
      test: true,
      count: selectedQuestions.length,
      category: category,
      questions: selectedQuestions,
      message: "Test endpoint working! This proves the API structure is correct."
    });

  } catch (error) {
    console.error('Test questions error:', error);
    res.status(500).json({
      error: 'Test endpoint failed',
      details: error.message,
      stack: error.stack
    });
  }
}