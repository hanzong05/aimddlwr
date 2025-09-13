// api/auth.js - Consolidated Authentication (Login + Register)
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.query;
  
  try {
    if (action === 'register') {
      return await handleRegister(req, res);
    } else if (action === 'login') {
      return await handleLogin(req, res);
    } else {
      return res.status(400).json({ error: 'Invalid action. Use ?action=login or ?action=register' });
    }
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
}

async function handleLogin(req, res) {
  const { email, password } = req.body;

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (error || !user) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(200).json({
    success: true,
    token,
    user: { id: user.id, email: user.email }
  });
}

async function handleRegister(req, res) {
  const { email, password, appId } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const { data: user, error } = await supabase
    .from('users')
    .insert([{ 
      email, 
      password: hashedPassword,
      app_id: appId || 'default',
      created_at: new Date().toISOString()
    }])
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    throw error;
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email, appId: appId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({
    success: true,
    token,
    user: { id: user.id, email: user.email }
  });
}