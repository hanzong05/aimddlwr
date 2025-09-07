export default async function handler(req, res) {
  res.status(200).json({ 
    status: 'healthy', 
    service: 'AI Middleware Service',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
}