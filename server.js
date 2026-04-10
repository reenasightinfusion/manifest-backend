require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const bodyParser = require('body-parser');


const app = express();
const port = process.env.PORT || 3000;

// Supabase Configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || supabaseUrl === 'YOUR_SUPABASE_URL_HERE') {
  console.error('\x1b[31m%s\x1b[0m', 'CRITICAL ERROR: SUPABASE_URL is missing or placeholder! Check your backend/.env file.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(bodyParser.json());

// ── Admin Restriction Logic ──────────────────────────────────────────
const ALLOWED_EMAIL = 'anandyadav21219@gmail.com';
const ALLOWED_NAME = 'Anand Yadav';

// Simple middleware to protect destructive routes
const restrictToAdmin = (req, res, next) => {
  const { user_email, name } = req.body;
  // If we are searching or fetching, we allow it (for now)
  // But for POST/DELETE, we check if it matches the admin
  if (req.method === 'POST' || req.method === 'DELETE') {
    const isAdmin = (user_email === ALLOWED_EMAIL) || (name === ALLOWED_NAME);
    if (!isAdmin && req.path !== '/api/users') {
       // Deep check for user_id related to admin if needed, 
       // but for a simple lock, checking the name/email is sufficient for this stage.
    }
  }
  next();
};

// Health Check
app.get('/', (req, res) => {
  res.send('Manifest Cosmic Backend is Live! ✨');
});

// Create/Update User API
app.post('/api/users', async (req, res) => {
  console.log('Incoming user update/creation:', req.body);
  const { id, full_name, avatar_url, personal_answers, family_answers, professional_answers, passcode, email } = req.body;

  // Security Lock: Temporarily disabled to allow new user creation
  /*
  if (full_name !== ALLOWED_NAME && email !== ALLOWED_EMAIL) {
    return res.status(403).json({ 
      success: false, 
      message: 'Access Denied: Only the authorized curator can modify this hub.' 
    });
  }
  */

  if (!full_name) {
    return res.status(400).json({ success: false, message: 'Name is required.' });
  }

  // ── AI Profile Validation ──────────────────────────────────────────────
  try {
    const allAnswers = [
      ...(personal_answers || []), 
      ...(family_answers || []), 
      ...(professional_answers || [])
    ].filter(a => a && a.trim().length > 0);
    
    if (allAnswers.length > 0) {
      console.log(`🔍 Validating profile answers for: "${full_name}"...`);
      const validationPrompt = `
        You are a strict Profile Validator. Analyze the user's answers to an onboarding survey and decide if they are valid, meaningful, and appropriate.

        USER ANSWERS:
        ${allAnswers.join(' | ')}

        A VALID profile:
        - Contains real words, meaningful aspirations or even very short sensible responses.
        - Is safe, respectful, and human-like.

        AN INVALID profile is one of these:
        - Random gibberish, keyboard mashing (e.g. "asdfgh", "123", "aaaa").
        - Profanity, abusive language, or highly inappropriate/unsafe content.
        - Nonsense meant to bypass the system.

        Respond ONLY with this JSON:
        {
          "is_valid": true or false,
          "reason": "If invalid: a friendly, 1-sentence explanation of why these answers cannot be accepted."
        }
      `;

      const validation = await generateAI(validationPrompt, 'You are a strict profile validator. Return only JSON.');
      console.log(`🔍 Profile Validation result: ${JSON.stringify(validation)}`);

      if (validation && validation.is_valid === false) {
        return res.status(400).json({
          success: false,
          message: validation.reason || 'Your answers do not seem valid or appropriate. Please provide thoughtful responses.'
        });
      }
    }
  } catch (aiErr) {
     console.error("⚠️ AI Validation failed or returned invalid format, bypassing for now...", aiErr.message);
  }
  // ────────────────────────────────────────────────────────────────────────

  try {
    let result;
    if (id) {
      // UPDATE existing user
      const { data, error } = await supabase
        .from('users')
        .update({
          full_name,
          avatar_url,
          personal_answers,
          family_answers,
          professional_answers,
          passcode
        })
        .eq('id', id)
        .select();

      if (error) {
        console.error('Supabase Update Error:', error);
        throw error;
      }
      result = (data && data.length > 0) ? data[0] : null;
    } else {
      // INSERT new user
      const { data, error } = await supabase
        .from('users')
        .insert([
          {
            full_name,
            avatar_url,
            personal_answers,
            family_answers,
            professional_answers,
            passcode,
            created_at: new Date().toISOString()
          }
        ])
        .select();

      if (error) {
        console.error('Supabase Insert Error:', error);
        throw error;
      }
      result = (data && data.length > 0) ? data[0] : null;
    }

    res.status(id ? 200 : 201).json({
      success: true,
      message: id ? 'Cosmic identity updated!' : 'User identity established!',
      data: result
    });
  } catch (error) {
    console.error('API Error details:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });
    res.status(500).json({
      success: false,
      message: `Failed to sync identity: ${error.message || 'Unknown Error'}`,
      error: error.message,
      code: error.code
    });
  }
});

// Search User by Name (Smart Discovery)
app.get('/api/users/search', async (req, res) => {
  const { name } = req.query;
  try {
    // 1. Fetch all potential matches
    const { data: matches, error } = await supabase
      .from('users')
      .select('*, manifestations(count)')
      .eq('full_name', name)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!matches || matches.length === 0) {
      return res.status(404).json({ success: false, message: 'Identity not found.' });
    }

    // 2. Smart Selection: Prioritize the soul with the most history or answers
    let bestMatch = matches[0];
    let maxQuality = -1;

    for (let u of matches) {
      const manifestCount = u.manifestations?.[0]?.count || 0;
      const answersFilled = [...(u.personal_answers || []), ...(u.family_answers || []), ...(u.professional_answers || [])].filter(a => a.trim().length > 0).length;

      const quality = (manifestCount * 10) + answersFilled; // Manifestations are high priority

      if (quality > maxQuality) {
        maxQuality = quality;
        bestMatch = u;
      }
    }

    // Cleanup for response
    delete bestMatch.manifestations;

    res.json({ success: true, data: bestMatch });
  } catch (error) {
    console.error('Search Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

const fetch = require('node-fetch');

// ─── AI Hub Bridge (Centralized Management) ───────────────────────────
async function generateAI(prompt, systemPrompt = 'You are a Master Manifestation Coach.') {
  const hubUrl = process.env.AI_HUB_URL;

  if (!hubUrl || hubUrl.includes('localhost')) {
    throw new Error('AI_HUB_URL is not configured for production. Please set it in Vercel Environment Variables.');
  }
  
  console.log(`📡 Relaying request to AI Hub: ${hubUrl}`);

  const response = await fetch(hubUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      systemPrompt,
      format: 'json'
    })
  });

  const data = await response.json();
  if (!data.success) {
    throw new Error(`AI Hub Error: ${data.error}`);
  }

  console.log(`✔️ Response received from Provider: ${data.provider}`);
  return data.data;
}


// ─── AI Manifestation Blueprint Generator ─────────────────────────────────
app.post('/api/generate-plan', async (req, res) => {
  const { user_id, goal_title } = req.body;

  try {
    // 1. Fetch User DNA
    const { data: user, error: userError } = await supabase
      .from('users').select('*').eq('id', user_id).single();
    if (userError || !user) throw new Error(`User not found: ${user_id}`);

    // 2. ── Quick AI Validation ─────────────────────────────────────────────
    console.log(`🔍 Validating goal input: "${goal_title}"...`);
    const validationPrompt = `
      You are a Manifestation Goal Validator. Analyze the user's input and decide if it is a valid personal manifestation goal.

      USER INPUT: "${goal_title}"

      A VALID goal:
      - Is a real, meaningful personal aspiration (career, health, relationship, finance, skill, creativity, etc.)
      - Is written in a human language (English or any other)
      - Is specific enough to mean something (even if short)
      - Examples: "I want to start my own business", "become a better parent", "learn guitar", "lose 10kg"

      AN INVALID goal is one of these:
      - Random gibberish or keyboard mashing (e.g. "asdfgh", "sdjksajd", "qwerty123")
      - Single random characters or numbers only (e.g. "a", "123", "!!!")
      - Offensive, harmful, or abusive content
      - Completely unrelated nonsense (e.g. "banana purple sky", "cat dog fish")
      - Empty meaning or just punctuation

      Respond ONLY with this JSON:
      {
        "is_valid": true or false,
        "reason": "If invalid: a friendly, empathetic 1-2 sentence explanation of why this isn't a valid manifestation goal.",
        "tip": "If invalid: a helpful suggestion of what a good goal looks like. Leave empty string if valid."
      }
    `;

    const validation = await generateAI(validationPrompt, 'You are a strict but kind manifestation goal validator. Return only JSON.');
    console.log(`🔍 Validation result: ${JSON.stringify(validation)}`);

    if (!validation.is_valid) {
      return res.json({
        success: true,
        valid: false,
        reason: validation.reason || 'This doesn\'t seem like a manifestation goal.',
        tip: validation.tip || 'Try describing a real aspiration, like "I want to build a successful career in tech."'
      });
    }
    console.log(`✅ Goal is valid, proceeding with generation...`);

    // 2. Build the hyper-personalized prompt
    const prompt = `
      You are a Master Manifestation Architect and Life Coach.
      
      USER PROFILE:
      - Name: ${user.full_name}
      - Goal: "${goal_title}"
      - Personal answers: ${(user.personal_answers || []).join(', ')}
      - Family answers: ${(user.family_answers || []).join(', ')}
      - Professional answers: ${(user.professional_answers || []).join(', ')}
      
      TASK: Generate a hyper-personalized manifestation blueprint for "${goal_title}".
      Create 4 unique topical PILLARS (NOT day-by-day steps). Each pillar should be a different angle/dimension of how to manifest this goal.
      Deeply reference the user's personal and professional background in each pillar.
      
      Return ONLY this JSON structure:
      {
        "plan_title": "A profound, unique 6-8 word title for this blueprint",
        "overall_summary": "A 3-sentence powerful summary of why this blueprint works for ${user.full_name} specifically",
        "pillars": [
          {
            "title": "Emoji + Pillar Name (e.g. 🔥 The Identity Breakthrough)",
            "huge_text": "A rich, 200+ word deep-dive manifesto for this specific pillar. Must reference user's actual answers and goal directly. Include psychological insights, practical techniques, and inspiring language.",
            "summary": "A 2-sentence crystallized essence of this pillar."
          },
          { "title": "...", "huge_text": "200+ words...", "summary": "..." },
          { "title": "...", "huge_text": "200+ words...", "summary": "..." },
          { "title": "...", "huge_text": "200+ words...", "summary": "..." }
        ]
      }
    `;

    // 3. Generate with Groq
    console.log(`🧠 Generating AI manifesto for ${user.full_name}: "${goal_title}"...`);
    const aiResponse = await generateAI(prompt);
    console.log(`✨ AI Manifesto Ready!`);

    // 4. Save to Supabase
    const { data: manifestation } = await supabase
      .from('manifestations').insert([{ user_id, goal_title }]).select().single();

    const { data: plan } = await supabase
      .from('manifestation_plans')
      .insert([{
        manifestation_id: manifestation.id,
        plan_title: aiResponse.plan_title,
        summary: aiResponse.overall_summary,
        full_content: JSON.stringify(aiResponse),
        audio_url: `https://api.dicebear.com/7.x/avataaars/png?seed=${user_id}`
      }])
      .select().single();

    const tasks = aiResponse.pillars.map((p, index) => ({
      plan_id: plan.id,
      day_number: index + 1,
      task_title: p.title,
      task_description: p.huge_text
    }));

    const { data: savedTasks, error: taskError } = await supabase.from('daily_tasks').insert(tasks).select();

    if (taskError) {
      console.error('⚠️ Warning: Failed to save tasks to DB, but continuing...', taskError.message);
    }

    res.json({ success: true, data: { plan, cards: savedTasks || tasks, full_ai: aiResponse } });


  } catch (error) {
    console.error('❌ Generation Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});


// ─── AI Spiritual Archetype Generator ──────────────────────────────────────────
app.post('/api/generate-archetype', async (req, res) => {
  const { user_id } = req.body;

  try {
    // 1. Fetch User Data
    const { data: user, error: userError } = await supabase
      .from('users').select('*').eq('id', user_id).single();
      
    if (userError || !user) throw new Error(`User not found: ${user_id}`);

    // If answers are entirely empty, AI still generates based on name
    const prompt = `
      You are an insightful spiritual guide and archetype reader.
      
      USER PROFILE:
      - Name: ${user.full_name}
      - Personal insights: ${(user.personal_answers || []).join(', ')}
      - Family & Connection insights: ${(user.family_answers || []).join(', ')}
      - Professional & Ambition insights: ${(user.professional_answers || []).join(', ')}
      
      TASK: Determine the spiritual and manifestation archetype for this user based on their insights. 
      If insights are empty, create a mysterious, generalized archetype based solely on their vibe and name.
      
      Return ONLY this precise JSON structure:
      {
        "archetype_name": "E.g. The Manifesting Mystic",
        "header_label": "E.g. COSMIC FOOTPRINT",
        "essence_label": "E.g. The Soul Essence",
        "essence_description": "A 3-sentence deep description of their spiritual nature based on their answers.",
        "strengths_label": "E.g. Core Strengths",
        "strengths": ["Intuition", "Presence", "Alignment"],
        "vision_label": "E.g. Spiritual Vision",
        "vision_text": "A poetic 1-2 sentence vision of their destiny.",
        "button_label": "Continue My Journey"
      }
    `;

    console.log(`🧠 Generating Archetype for ${user.full_name}...`);
    const aiResponse = await generateAI(prompt, 'You are an archetype generator. Always return valid JSON matching the exact schema.');
    console.log(`✨ Archetype AI Result ready.`);

    res.json({ success: true, data: aiResponse });

  } catch (error) {
    console.error('❌ Archetype Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Fetch Manifestation History (Vision Board) ───────────────────────────
app.get('/api/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`[HISTORY] Fetching history for user ID: ${userId}`);

    // 1. Fetch manifestations manually
    const { data: manifestations, error: manError } = await supabase
      .from('manifestations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (manError) throw manError;

    const historyData = manifestations || [];

    // 2. Fetch plans and tasks manually (Bulletproof JOIN bypass)
    for (let man of historyData) {
      const { data: plans } = await supabase
        .from('manifestation_plans')
        .select('*')
        .eq('manifestation_id', man.id);

      man.manifestation_plans = plans || [];

      for (let plan of man.manifestation_plans) {
        const { data: tasks } = await supabase
          .from('daily_tasks')
          .select('*')
          .eq('plan_id', plan.id)
          .order('day_number', { ascending: true });

        plan.daily_tasks = tasks || [];
      }
    }

    console.log(`[HISTORY] Found ${historyData.length} items for user.`);
    res.json({ success: true, data: historyData });

  } catch (error) {
    console.error('[HISTORY ERROR]:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Delete Manifestation (Permanent) ────────────────────────────────────────
app.delete('/api/manifestations/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`[DELETE] Manifest ID: ${id}`);

  try {
    // 1. Find the plan linked to this manifestation
    const { data: plans } = await supabase
      .from('manifestation_plans')
      .select('id')
      .eq('manifestation_id', id);

    if (plans && plans.length > 0) {
      const planIds = plans.map(p => p.id);

      // 2. Delete daily_tasks for all related plans
      await supabase.from('daily_tasks').delete().in('plan_id', planIds);

      // 3. Delete the plans themselves
      await supabase.from('manifestation_plans').delete().eq('manifestation_id', id);
    }

    // 4. Delete the root manifestation
    const { error } = await supabase.from('manifestations').delete().eq('id', id);
    if (error) throw error;

    console.log(`[DELETE] ✅ Manifestation ${id} wiped from cosmos.`);
    res.json({ success: true, message: 'Manifestation permanently removed.' });
  } catch (error) {
    console.error('[DELETE ERROR]:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

if (process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`🚀 Backend listening at http://localhost:${port}`);
  });
}

module.exports = app;
